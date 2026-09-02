export type Vec3 = Readonly<{ x: number; y: number; z: number }>;

export type Camera3D = Readonly<{
  position: Vec3;
  lookAt: Vec3;
  fovDegrees: number;
}>;

export type ProjectedPoint = Readonly<{
  x: number;
  y: number;
  depth: number;
  scale: number;
}>;

export type MeshFace = Readonly<{
  points: readonly Vec3[];
  color: string;
}>;

export type EulerRotation = Readonly<{
  x?: number;
  y?: number;
  z?: number;
}>;

type CameraBasis = Readonly<{
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}>;

const NEAR_PLANE = 0.12;

export function projectPoint(
  point: Vec3,
  camera: Camera3D,
  viewportWidth: number,
  viewportHeight: number,
): ProjectedPoint | undefined {
  const basis = cameraBasis(camera);
  const relative = subtract(point, camera.position);
  const depth = dot(relative, basis.forward);
  if (depth <= NEAR_PLANE) return undefined;
  const focalLength = Math.max(1, viewportHeight) * 0.5
    / Math.tan((camera.fovDegrees * Math.PI) / 360);
  const scale = focalLength / depth;
  return {
    x: viewportWidth * 0.5 + dot(relative, basis.right) * scale,
    y: viewportHeight * 0.5 - dot(relative, basis.up) * scale,
    depth,
    scale,
  };
}

export function buildCylinderFaces(
  center: Vec3,
  radiusX: number,
  radiusZ: number,
  height: number,
  segments: number,
  topColor: string,
  sideColor: string,
): MeshFace[] {
  const count = Math.max(3, Math.round(segments));
  const top = center.y + height * 0.5;
  const bottom = center.y - height * 0.5;
  const topRing: Vec3[] = [];
  const bottomRing: Vec3[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const x = center.x + Math.sin(angle) * radiusX;
    const z = center.z + Math.cos(angle) * radiusZ;
    topRing.push({ x, y: top, z });
    bottomRing.push({ x, y: bottom, z });
  }
  const faces: MeshFace[] = [];
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    faces.push({
      points: [topRing[index], topRing[next], bottomRing[next], bottomRing[index]],
      color: sideColor,
    });
  }
  faces.push({ points: [...topRing].reverse(), color: topColor });
  return faces;
}

export function buildEllipsoidFaces(
  center: Vec3,
  radii: Vec3,
  latitudeSegments: number,
  longitudeSegments: number,
  color: string,
  rotation: EulerRotation = {},
): MeshFace[] {
  const latitudes = Math.max(3, Math.round(latitudeSegments));
  const longitudes = Math.max(4, Math.round(longitudeSegments));
  const rows: Vec3[][] = [];
  for (let latitude = 0; latitude <= latitudes; latitude += 1) {
    const phi = -Math.PI * 0.5 + (latitude / latitudes) * Math.PI;
    const row: Vec3[] = [];
    for (let longitude = 0; longitude < longitudes; longitude += 1) {
      const theta = (longitude / longitudes) * Math.PI * 2;
      const local = {
        x: Math.sin(theta) * Math.cos(phi) * radii.x,
        y: Math.sin(phi) * radii.y,
        z: Math.cos(theta) * Math.cos(phi) * radii.z,
      };
      const rotated = rotatePoint(local, rotation);
      row.push({ x: center.x + rotated.x, y: center.y + rotated.y, z: center.z + rotated.z });
    }
    rows.push(row);
  }
  const faces: MeshFace[] = [];
  for (let latitude = 0; latitude < latitudes; latitude += 1) {
    for (let longitude = 0; longitude < longitudes; longitude += 1) {
      const next = (longitude + 1) % longitudes;
      faces.push({
        points: [rows[latitude][longitude], rows[latitude][next], rows[latitude + 1][next], rows[latitude + 1][longitude]],
        color,
      });
    }
  }
  return faces;
}

export function sortFacesBackToFront(faces: readonly MeshFace[], camera: Camera3D): MeshFace[] {
  const basis = cameraBasis(camera);
  return [...faces].sort((left, right) => faceDepth(right, camera.position, basis.forward)
    - faceDepth(left, camera.position, basis.forward));
}

export function faceNormal(points: readonly Vec3[]): Vec3 {
  if (points.length < 3) return { x: 0, y: 1, z: 0 };
  return normalize(cross(subtract(points[1], points[0]), subtract(points[2], points[0])));
}

export function shadeColor(hex: string, factor: number): string {
  const source = hex.startsWith('#') ? hex.slice(1) : hex;
  if (source.length !== 6) return hex;
  const bounded = clamp(factor, 0, 1.6);
  const channels = [0, 2, 4].map((offset) => Math.round(parseInt(source.slice(offset, offset + 2), 16) * bounded));
  return `rgb(${channels.map((channel) => clamp(channel, 0, 255)).join(' ')})`;
}

export function cameraForward(camera: Camera3D): Vec3 {
  return cameraBasis(camera).forward;
}

export function dot(left: Vec3, right: Vec3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cameraBasis(camera: Camera3D): CameraBasis {
  const forward = normalize(subtract(camera.lookAt, camera.position));
  const right = normalize(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = normalize(cross(right, forward));
  return { forward, right, up };
}

function faceDepth(face: MeshFace, cameraPosition: Vec3, forward: Vec3): number {
  const center = face.points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y, z: sum.z + point.z }),
    { x: 0, y: 0, z: 0 },
  );
  const count = Math.max(1, face.points.length);
  return dot(
    { x: center.x / count - cameraPosition.x, y: center.y / count - cameraPosition.y, z: center.z / count - cameraPosition.z },
    forward,
  );
}

function rotatePoint(point: Vec3, rotation: EulerRotation): Vec3 {
  const rx = rotation.x ?? 0;
  const ry = rotation.y ?? 0;
  const rz = rotation.z ?? 0;
  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const afterX = {
    x: point.x,
    y: point.y * cosX - point.z * sinX,
    z: point.y * sinX + point.z * cosX,
  };
  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const afterY = {
    x: afterX.x * cosY + afterX.z * sinY,
    y: afterX.y,
    z: -afterX.x * sinY + afterX.z * cosY,
  };
  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);
  return {
    x: afterY.x * cosZ - afterY.y * sinZ,
    y: afterY.x * sinZ + afterY.y * cosZ,
    z: afterY.z,
  };
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function normalize(value: Vec3): Vec3 {
  const length = Math.hypot(value.x, value.y, value.z) || 1;
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
