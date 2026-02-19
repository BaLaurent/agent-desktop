import { useState, useEffect, useRef, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'

interface ScadPreviewProps {
  filePath: string
  lastSavedAt: number
}

function AutoFit({ model }: { model: THREE.Group }) {
  const { camera } = useThree()
  useEffect(() => {
    const box = new THREE.Box3().setFromObject(model)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    model.position.sub(center)
    const maxDim = Math.max(size.x, size.y, size.z)
    const dist = maxDim * 2
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.position.set(dist, dist * 0.7, dist)
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
    }
  }, [model, camera])
  return null
}

export function ScadPreview({ filePath, lastSavedAt }: ScadPreviewProps) {
  const [model, setModel] = useState<THREE.Group | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    window.agent.openscad.compile(filePath)
      .then((result) => {
        if (cancelled) return
        const binary = Uint8Array.from(atob(result.data), c => c.charCodeAt(0))
        const loader = new ThreeMFLoader()
        const group = loader.parse(binary.buffer)
        // OpenSCAD is Z-up, Three.js is Y-up — rotate to align
        group.rotation.x = -Math.PI / 2
        setModel(group)
        setWarnings(result.warnings)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [filePath, lastSavedAt])

  const bgColor = useMemo(() => {
    const style = getComputedStyle(document.documentElement)
    return style.getPropertyValue('--color-deep').trim() || '#1a1a2e'
  }, [])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Compiling OpenSCAD...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <pre className="text-sm text-error font-mono whitespace-pre-wrap max-w-lg">{error}</pre>
      </div>
    )
  }

  if (!model) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted">
        Save the file to compile and preview
      </div>
    )
  }

  return (
    <div ref={containerRef} className="h-full w-full flex flex-col">
      {warnings && (
        <div className="px-3 py-1.5 text-xs flex-shrink-0 bg-warning" style={{ color: '#000' }}>
          {warnings}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <Canvas
          camera={{ position: [5, 5, 5], fov: 50 }}
          style={{ background: bgColor }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 5, 5]} intensity={0.8} />
          <primitive object={model} />
          <AutoFit model={model} />
          <OrbitControls makeDefault />
          <gridHelper args={[100, 100, '#444', '#222']} />
        </Canvas>
      </div>
    </div>
  )
}
