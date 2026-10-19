import { Html, Line, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { Cone, PathSegment } from '../api/types'

export interface ScenePath {
  id: string
  name: string
  segments: PathSegment[]
  color: string
  isCtc: boolean | null
}

interface Props {
  cones: Cone[]
  criticalRadius: number | null
  paths: ScenePath[]
  timeScale: number
  showCones: boolean
  showCritical: boolean
  rMax: number
}

const CTC_COLOR = '#ff5fa2'
const CONE_IN = '#5fd4e8'
const CONE_OUT = '#fab219'

function tRange(paths: ScenePath[]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const p of paths) for (const s of p.segments) for (const pt of s.points) {
    lo = Math.min(lo, pt[1])
    hi = Math.max(hi, pt[1])
  }
  if (!Number.isFinite(lo)) return [-1, 1]
  if (hi - lo < 0.5) return [lo - 0.5, hi + 0.5]
  return [lo, hi]
}

export function autoTimeScale(paths: ScenePath[]): number {
  const [lo, hi] = tRange(paths)
  return Math.min(1, 3.2 / Math.max(hi - lo, 1e-6))
}

function ConeMesh({ cone, ts, dt }: { cone: Cone; ts: number; dt: number }) {
  const geo = useMemo(() => {
    const [ax, at, az] = cone.apex
    const pos: number[] = []
    const n = cone.ring.length
    for (let i = 0; i < n; i++) {
      const a = cone.ring[i]
      const b = cone.ring[(i + 1) % n]
      pos.push(ax, (at + dt) * ts, az, a[0], (a[1] + dt) * ts, a[2], b[0], (b[1] + dt) * ts, b[2])
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.computeVertexNormals()
    return g
  }, [cone, ts, dt])
  const ring = useMemo(
    () => [...cone.ring, cone.ring[0]].map((p) => [p[0], (p[1] + dt) * ts, p[2]] as [number, number, number]),
    [cone, ts, dt],
  )
  const color = cone.tipped ? CONE_OUT : CONE_IN
  return (
    <group>
      <mesh geometry={geo}>
        <meshBasicMaterial color={color} transparent opacity={cone.tipped ? 0.4 : 0.28} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={ring} color={color} lineWidth={1} transparent opacity={0.85} />
    </group>
  )
}

function Label({ position, children, color = '#a9b6c4' }: { position: [number, number, number]; children: string; color?: string }) {
  return (
    <Html position={position} center style={{ pointerEvents: 'none' }}>
      <span style={{ color, fontSize: 11, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', textShadow: '0 0 4px #000' }}>{children}</span>
    </Html>
  )
}

function Axes({ rMax, t0, t1, ts }: { rMax: number; t0: number; t1: number; ts: number }) {
  const L = rMax * 1.12
  const circles = [0.5, 1, 1.5, 2, 2.5, 3].filter((r) => r <= rMax + 1e-9)
  const tStep = niceStep((t1 - t0) / 5)
  const ticks: number[] = []
  for (let t = Math.ceil(t0 / tStep) * tStep; t <= t1 + 1e-9; t += tStep) ticks.push(Number(t.toPrecision(6)))
  return (
    <group>
      <Line points={[[-L, 0, 0], [L, 0, 0]]} color="#46607a" lineWidth={1} />
      <Line points={[[0, 0, -L], [0, 0, L]]} color="#46607a" lineWidth={1} />
      <Line points={[[0, t0 * ts, 0], [0, t1 * ts + 0.3, 0]]} color="#8fb3d1" lineWidth={1.5} />
      <Label position={[L + 0.15, 0, 0]}>X = r cosφ</Label>
      <Label position={[0, 0, L + 0.15]}>Z = r sinφ</Label>
      <Label position={[0, t1 * ts + 0.45, 0]} color="#e6edf3">t（座標時間）↑</Label>
      {circles.map((r) => (
        <group key={r}>
          <Line
            points={Array.from({ length: 97 }, (_, i) => {
              const a = (i / 96) * Math.PI * 2
              return [r * Math.cos(a), 0, r * Math.sin(a)] as [number, number, number]
            })}
            color="#22303f"
            lineWidth={1}
          />
          <Label position={[r, -0.06, 0.02]} color="#6f7f91">{`r=${r}`}</Label>
        </group>
      ))}
      {ticks.map((t) => (
        <group key={t}>
          <Line points={[[-0.05, t * ts, 0], [0.05, t * ts, 0]]} color="#8fb3d1" lineWidth={1} />
          <Label position={[-0.28, t * ts, 0]} color="#6f7f91">{`t=${t}`}</Label>
        </group>
      ))}
    </group>
  )
}

function niceStep(x: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-9))))
  const m = x / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}

function PathLines({ path, ts }: { path: ScenePath; ts: number }) {
  return (
    <group>
      {path.segments.map((seg, i) => {
        const pts = seg.points.map((p) => [p[0], p[1] * ts, p[2]] as [number, number, number])
        if (pts.length < 2) return null
        const ctc = seg.highlight
        const color = ctc ? CTC_COLOR : seg.causal === 'spacelike' ? '#d03b3b' : seg.causal === 'boundary' ? '#fab219' : path.color
        return (
          <group key={i}>
            {ctc && <Line points={pts} color={CTC_COLOR} lineWidth={9} transparent opacity={0.22} />}
            <Line points={pts} color={color} lineWidth={ctc ? 3 : 2.2} dashed={seg.causal === 'spacelike'} dashSize={0.06} gapSize={0.04} />
          </group>
        )
      })}
      {path.segments[0]?.points[0] && (
        <mesh position={[path.segments[0].points[0][0], path.segments[0].points[0][1] * ts, path.segments[0].points[0][2]]}>
          <sphereGeometry args={[0.035, 16, 16]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      )}
    </group>
  )
}

export function SpacetimeScene({ cones, criticalRadius, paths, timeScale, showCones, showCritical, rMax }: Props) {
  const [t0, t1] = tRange(paths)
  const ts = timeScale
  // 計量は t に依存しない（定常）ので、t 方向に平行移動した位置にも同じ光円錐を描ける
  const levels = useMemo(() => {
    return [(t0 + t1) / 2]
  }, [t0, t1])
  return (
    <Canvas camera={{ position: [3.6, 2.6, 3.6], fov: 45, near: 0.01, far: 200 }} dpr={[1, 2]} data-testid="spacetime-canvas">
      <color attach="background" args={['#05080c']} />
      <ambientLight intensity={0.6} />
      <group position={[0, -((t0 + t1) / 2) * ts, 0]}>
        <Axes rMax={rMax} t0={t0} t1={t1} ts={ts} />
        {showCritical && criticalRadius !== null && (
          <mesh position={[0, ((t0 + t1) / 2) * ts, 0]}>
            <cylinderGeometry args={[criticalRadius, criticalRadius, (t1 - t0) * ts + 0.4, 72, 1, true]} />
            <meshBasicMaterial color={CONE_OUT} transparent opacity={0.07} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        )}
        {showCritical && criticalRadius !== null && [t0, t1].map((t) => (
          <Line key={t}
            points={Array.from({ length: 97 }, (_, i) => {
              const a = (i / 96) * Math.PI * 2
              return [criticalRadius * Math.cos(a), t * ts, criticalRadius * Math.sin(a)] as [number, number, number]
            })}
            color={CONE_OUT} lineWidth={1} dashed dashSize={0.05} gapSize={0.05} />
        ))}
        {showCones && levels.map((lv) => cones.map((c, i) => <ConeMesh key={`${lv}-${i}`} cone={c} ts={ts} dt={lv - c.apex[1]} />))}
        {paths.map((p) => <PathLines key={p.id} path={p} ts={ts} />)}
      </group>
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} minDistance={0.8} maxDistance={30} />
    </Canvas>
  )
}
