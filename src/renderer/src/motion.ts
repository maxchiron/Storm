import type { Variants } from 'framer-motion'

/** Shared easing curves — one place to keep the whole app feeling consistent. */
export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]
export const EASE_SOFT: [number, number, number, number] = [0.32, 0.72, 0, 1]

export const SPRING_SNAPPY = { type: 'spring', stiffness: 420, damping: 34 } as const
export const SPRING_SOFT = { type: 'spring', stiffness: 240, damping: 28 } as const

export const wallContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.035, delayChildren: 0.02 }
  }
}

export const wallItem: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.96 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.42, ease: EASE }
  }
}

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } }
}
