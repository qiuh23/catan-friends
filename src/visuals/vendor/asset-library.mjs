/** Shared GLB cache for this static, unskinned asset kit.
 * Inject GLTFLoader from the target project's installed Three.js.
 * No renderer, RAF, network request until load()/instantiate() is called.
 */
export function createAssetLibrary({ GLTFLoader, baseURL = '/', onError = () => {} }) {
  if (typeof GLTFLoader !== 'function') throw new TypeError('GLTFLoader constructor required');
  const loader = new GLTFLoader();
  const cache = new Map();
  const instances = new Set();
  const geometries = new Set(), materials = new Set(), textures = new Set();
  let closed = false;
  let disposal = null;
  const resolve = (file) => {
    if (typeof file !== 'string' || !file) throw new TypeError('Asset URL must be a nonempty string');
    if (/^(https?:|data:|blob:|\/)/.test(file)) return file;
    return `${baseURL.replace(/\/$/, '')}/${file.replace(/^\//, '')}`;
  };
  function remember(scene) {
    scene.traverse((o) => {
      if (!o.isMesh) return;
      if (o.geometry) geometries.add(o.geometry);
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
  }
  function load(file) {
    if (closed) return Promise.reject(new Error('Asset library is disposed'));
    const url = resolve(file);
    if (!cache.has(url)) {
      const request = loader.loadAsync(url).then((gltf) => {
        if (!gltf?.scene) throw new Error(`No scene in ${url}`);
        remember(gltf.scene);
        return gltf;
      }).catch((error) => {
        cache.delete(url); // A later explicit load can retry; no automatic request loop.
        try { onError(error, url); } catch { /* Preserve the original load error. */ }
        throw error;
      });
      cache.set(url, request);
    }
    return cache.get(url);
  }
  async function instantiate(file, { ownerColor, castShadow = true, receiveShadow = true } = {}) {
    const gltf = await load(file);
    if (closed) throw new Error('Asset library was disposed during load');
    const object = gltf.scene.clone(true);
    const owned = new Set();
    const clonedByOriginal = new Map();
    try { object.traverse((o) => {
      if (o.isSkinnedMesh) throw new Error('This helper does not support skinned assets');
      if (!o.isMesh) return;
      o.castShadow = castShadow;
      o.receiveShadow = receiveShadow;
      const sourceMaterials = Array.isArray(o.material) ? o.material : [o.material];
      const next = sourceMaterials.map((m) => {
        if (!m || ownerColor == null || m.name !== 'OwnerTint') return m;
        if (!clonedByOriginal.has(m)) {
          const copy = m.clone();
          copy.color.set(ownerColor); // GLTFLoader already handles colour space.
          clonedByOriginal.set(m, copy);
          owned.add(copy);
        }
        return clonedByOriginal.get(m);
      });
      o.material = Array.isArray(o.material) ? next : next[0];
    });
    } catch (error) {
      for (const material of owned) material.dispose();
      throw error;
    }
    let released = false;
    const handle = {
      object,
      release() {
        if (released) return;
        released = true;
        object.removeFromParent();
        for (const material of owned) material.dispose();
        instances.delete(handle);
        // Shared geometry/material/texture lives until library.dispose().
      },
    };
    instances.add(handle);
    return handle;
  }
  function dispose() {
    if (disposal) return disposal;
    closed = true;
    for (const instance of [...instances]) instance.release();
    // A request already in flight cannot be cancelled by GLTFLoader here.
    // Wait for it and dispose its resources rather than leaking them.
    disposal = Promise.allSettled([...cache.values()]).then(() => {
      for (const texture of textures) texture.dispose();
      for (const material of materials) material.dispose();
      for (const geometry of geometries) geometry.dispose();
      cache.clear(); textures.clear(); materials.clear(); geometries.clear();
    });
    return disposal;
  }
  return { load, instantiate, dispose };
}

/** Create detached InstancedMeshes. Attach each directly to land/pieces in Catan.
 * Does not add a Group layer that would break current nonrecursive occlusion tests.
 * matrices are instance transforms in the destination parent's local coordinates.
 */
export function createInstancedParts(THREE, sourceScene, matrices, {
  ownerColors = null, tileIds = null, castShadow = true, receiveShadow = true,
} = {}) {
  if (!Array.isArray(matrices) || !matrices.length) throw new Error('At least one instance matrix required');
  if (ownerColors && ownerColors.length !== matrices.length) throw new Error('ownerColors count mismatch');
  if (tileIds && tileIds.length !== matrices.length) throw new Error('tileIds count mismatch');
  sourceScene.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(sourceScene.matrixWorld).invert();
  const meshes = [], ownedGeometries = [], ownedMaterials = [];
  try {
    sourceScene.traverse((source) => {
      if (source.isSkinnedMesh) throw new Error('Skinned assets are not supported');
      if (!source.isMesh) return;
      const local = new THREE.Matrix4().multiplyMatrices(inverse, source.matrixWorld);
      const geometry = source.geometry.clone().applyMatrix4(local);
      ownedGeometries.push(geometry);
      let material = source.material;
      if (ownerColors && Array.isArray(material) && material.some(m => m.name === 'OwnerTint')) {
        throw new Error('Split OwnerTint into its own single-material mesh before instancing');
      }
      const ownerPart = ownerColors && !Array.isArray(material) && material?.name === 'OwnerTint';
      if (ownerPart) {
        material = material.clone();
        material.color.set(0xffffff); // Instance colour replaces, rather than multiplies, coral base.
        ownedMaterials.push(material);
      }
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      mesh.name = source.name;
      matrices.forEach((matrix, i) => {
        mesh.setMatrixAt(i, matrix);
        if (ownerPart) mesh.setColorAt(i, new THREE.Color(ownerColors[i]));
      });
      mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
      if (tileIds) mesh.userData.tileIds = [...tileIds];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingBox(); mesh.computeBoundingSphere();
      meshes.push(mesh);
    });
  } catch (error) {
    for (const mesh of meshes) { mesh.removeFromParent(); mesh.dispose(); }
    for (const geometry of ownedGeometries) geometry.dispose();
    for (const material of ownedMaterials) material.dispose();
    throw error;
  }
  let disposed = false;
  return {
    meshes,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of meshes) { mesh.removeFromParent(); mesh.dispose(); }
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
    },
  };
}
