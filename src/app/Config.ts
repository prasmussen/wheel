export interface PhysicsConfig {
  wheelInertia: number;
  linearDrag: number;
  brakeDrag: number;
  quadraticDrag: number;
  bearingFriction: number;
  pointerSpring: number;
  pointerDamping: number;
  pointerInertia: number;
  collisionRestitution: number;
  collisionCoupling: number;
}

export const DEFAULT_PHYSICS: PhysicsConfig = {
  wheelInertia: 2.8,
  linearDrag: 0.32,
  brakeDrag: 1.4,
  // The speed-sensitive brake supplies the fast coasting drag.
  quadraticDrag: 0,
  bearingFriction: 0.32,
  pointerSpring: 100,
  pointerDamping: 0.55,
  pointerInertia: 0.01,
  collisionRestitution: 0.16,
  collisionCoupling: 0.075,
};

export const FIXED_DT = 1 / 240;

// Increment when seeded trajectories change. Replay is scoped to this version.
export const SIMULATION_VERSION = 6;
