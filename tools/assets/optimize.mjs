// Offline-only asset preparation; the game does not depend on these tools.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import validator from 'gltf-validator';

const models = fileURLToPath(new URL('../../public/models/', import.meta.url));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const variants = [
  { source: 'citizen-realistic.glb', output: 'citizen-optimized.glb', ratio: .32, error: .005, textureSize: 1024 },
  { source: 'citizen-realistic.glb', output: 'citizen-distant.glb', ratio: .08, error: .015, textureSize: 512 },
  { source: 'concept-car.glb', output: 'concept-optimized.glb', ratio: .29, error: .008, textureSize: 1024 },
];

function topology(doc) {
  const root = doc.getRoot(), nodes = root.listNodes();
  // NodeIO omits transforms within 1e-6 of the glTF identity defaults.
  const rounded = values => values.map(v => Math.round(v * 1e5) / 1e5);
  return {
    nodes: nodes.map(n => ({ name: n.getName(), children: n.listChildren().map(c => nodes.indexOf(c)),
      translation: rounded(n.getTranslation()), rotation: rounded(n.getRotation()), scale: rounded(n.getScale()) })),
    skins: root.listSkins().map(s => ({ name: s.getName(), joints: s.listJoints().map(n => nodes.indexOf(n)),
      inverseBindMatrices: Array.from(s.getInverseBindMatrices().getArray()) })),
    animations: root.listAnimations().map(a => ({ name: a.getName(), channels: a.listChannels().map(c => ({
      node: nodes.indexOf(c.getTargetNode()), path: c.getTargetPath(), interpolation: c.getSampler().getInterpolation(),
      input: Array.from(c.getSampler().getInput().getArray()),
      output: Array.from(c.getSampler().getOutput().getArray()),
    })) })),
    materials: root.listMaterials().map(m => m.getName()),
  };
}

function metrics(doc) {
  const root = doc.getRoot();
  const tris = mesh => mesh.listPrimitives().reduce((sum, p) => sum + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3, 0);
  return {
    triangles: root.listMeshes().reduce((sum, m) => sum + tris(m), 0),
    sceneTriangles: root.listNodes().reduce((sum, n) => sum + (n.getMesh() ? tris(n.getMesh()) : 0), 0),
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    primitives: root.listMeshes().reduce((sum, m) => sum + m.listPrimitives().length, 0),
    skins: root.listSkins().length,
    animations: root.listAnimations().length,
    textures: root.listTextures().map(t => ({ name: t.getName(), mime: t.getMimeType(), size: t.getSize(), bytes: t.getImage()?.byteLength ?? 0 })),
  };
}

await MeshoptSimplifier.ready;
const report = [];
for (const variant of variants) {
  const doc = await io.read(models + variant.source);
  const before = metrics(doc), structure = JSON.stringify(topology(doc));
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: variant.ratio, error: variant.error }),
    textureCompress({ encoder: sharp, resize: [variant.textureSize, variant.textureSize], quality: 88, effort: 80 }),
  );
  if (structure !== JSON.stringify(topology(doc))) throw new Error(`Topology/animation/material names changed: ${variant.output}`);
  await io.write(models + variant.output, doc);
  const bytes = await readFile(models + variant.output);
  const validation = await validator.validateBytes(new Uint8Array(bytes), { uri: variant.output, maxIssues: 1000 });
  const reread = await io.read(models + variant.output);
  if (structure !== JSON.stringify(topology(reread))) throw new Error(`Round-trip topology changed: ${variant.output}`);
  const item = { ...variant,
    before: { ...before, bytes: (await stat(models + variant.source)).size,
      sha256: createHash('sha256').update(await readFile(models + variant.source)).digest('hex') },
    after: { ...metrics(reread), bytes: bytes.length },
    validation: { ...validation.issues, messages: validation.issues.messages.filter(m => m.severity <= 1) },
  };
  report.push(item);
  console.log(JSON.stringify({ output: variant.output, triangles: item.after.triangles, bytes: bytes.length,
    nodes: item.after.nodes, skins: item.after.skins, animations: item.after.animations,
    errors: validation.issues.numErrors, warnings: validation.issues.numWarnings }));
  if (validation.issues.numErrors) throw new Error(`Invalid GLB: ${variant.output}`);
}
await writeFile(new URL('./asset-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
