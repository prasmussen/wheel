export interface PhysicsConfig {
  wheelInertia: number;
  linearDrag: number;
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
  quadraticDrag: 0.028,
  bearingFriction: 0.32,
  pointerSpring: 100,
  pointerDamping: 4.2,
  pointerInertia: 0.075,
  collisionRestitution: 0.16,
  collisionCoupling: 0.075,
};

export const FIXED_DT = 1 / 240;
