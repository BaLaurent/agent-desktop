import { useState, useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'

interface ModelPreviewProps {
  filePath: string
  content: string  // base64 for binary formats (.stl, .3mf, .ply), text for .obj
}

function getFileExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) return ''
  return filePath.slice(dot + 1).toLowerCase()
}

// Z-up formats (CAD tools) need rotation to match Three.js Y-up
const Z_UP_FORMATS = new Set(['stl', '3mf'])

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

function parseModel(ext: string, content: string): THREE.Group {
  const group = new THREE.Group()

  if (ext === 'obj') {
    // OBJ is text-based — content is raw text
    const loader = new OBJLoader()
    const parsed = loader.parse(content)
    group.add(parsed)
  } else {
    // Binary formats — content is base64
    const binary = Uint8Array.from(atob(content), c => c.charCodeAt(0))
    const buffer = binary.buffer

    if (ext === 'stl') {
      const geometry = new STLLoader().parse(buffer)
      const material = new THREE.MeshStandardMaterial({ color: 0x8899aa, flatShading: true })
      group.add(new THREE.Mesh(geometry, material))
    } else if (ext === '3mf') {
      const parsed = new ThreeMFLoader().parse(buffer)
      group.add(parsed)
    } else if (ext === 'ply') {
      const geometry = new PLYLoader().parse(buffer)
      const hasColors = geometry.hasAttribute('color')
      const material = new THREE.MeshStandardMaterial({
        color: hasColors ? 0xffffff : 0x8899aa,
        vertexColors: hasColors,
        flatShading: !hasColors,
      })
      group.add(new THREE.Mesh(geometry, material))
    }
  }

  // Apply Z-up to Y-up rotation for CAD formats
  if (Z_UP_FORMATS.has(ext)) {
    group.rotation.x = -Math.PI / 2
  }

  return group
}

export function ModelPreview({ filePath, content }: ModelPreviewProps) {
  const [model, setModel] = useState<THREE.Group | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ext = getFileExtension(filePath)

  useEffect(() => {
    try {
      const group = parseModel(ext, content)
      setModel(group)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setModel(null)
    }
  }, [ext, content])

  const bgColor = useMemo(() => {
    const style = getComputedStyle(document.documentElement)
    return style.getPropertyValue('--color-deep').trim() || '#1a1a2e'
  }, [])

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
        Loading model...
      </div>
    )
  }

  return (
    <div className="h-full w-full">
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
  )
}
