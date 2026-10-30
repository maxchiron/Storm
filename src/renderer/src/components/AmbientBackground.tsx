import { useEffect } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'

/**
 * Slow-drifting aurora blobs behind the whole app, with a gentle parallax
 * that follows the pointer. Purely decorative.
 */
export default function AmbientBackground(): React.JSX.Element {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const springX = useSpring(x, { stiffness: 40, damping: 22, mass: 0.6 })
  const springY = useSpring(y, { stiffness: 40, damping: 22, mass: 0.6 })

  const blobA = useTransform(springX, [-1, 1], [-26, 26])
  const blobAy = useTransform(springY, [-1, 1], [-18, 18])
  const blobB = useTransform(springX, [-1, 1], [22, -22])
  const blobBy = useTransform(springY, [-1, 1], [14, -14])

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1
      const ny = (e.clientY / window.innerHeight) * 2 - 1
      x.set(nx)
      y.set(ny)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [x, y])

  return (
    <div className="ambient" aria-hidden="true">
      <motion.div className="ambient-blob ambient-blob--a" style={{ x: blobA, y: blobAy }} />
      <motion.div className="ambient-blob ambient-blob--b" style={{ x: blobB, y: blobBy }} />
      <motion.div className="ambient-blob ambient-blob--c" />
      <div className="ambient-grain" />
      <div className="ambient-vignette" />
    </div>
  )
}
