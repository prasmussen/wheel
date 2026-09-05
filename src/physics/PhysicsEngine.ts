import type { PhysicsConfig } from "../app/Config";
import { clamp, signedAngle, TAU, wrapAngle } from "../utils/Math";
import type { RandomSource } from "../utils/Random";

export interface WheelState { angle: number; angularVelocity: number }
export interface PointerState { angle: number; angularVelocity: number }
export interface PegImpact {
  pegIndex: number;
  strength: number;
  wheelVelocity: number;
  timestamp: number;
}

export interface PhysicsSnapshot {
  wheel: WheelState;
  pointer: PointerState;
  currentPeg: number;
  lastImpact: number;
  stableTime: number;
}

export class PhysicsEngine {
  readonly wheel: WheelState = { angle: 0, angularVelocity: 0 };
  readonly pointer: PointerState = { angle: 0, angularVelocity: 0 };
  private impactListeners = new Set<(event: PegImpact) => void>();
  private lastPeg = -1;
  private contactPeg = -1;
  private contactDirection = 1;
  private wheelContactTorque = 0;
  private lastWheelDirection = 1;
  private lastImpactTime = -1;
  private simTime = 0;
  private launchTorque = 0;
  private launchRemaining = 0;
  private restitutionScale = 1;
  private dragScale = 1;
  stableTime = 0;
  lastImpactStrength = 0;

  constructor(public config: PhysicsConfig, public segmentCount: number) {
    // Begin in a mechanically valid detent: the pointer sits halfway between
    // two pegs instead of occupying the same space as one.
    this.wheel.angle = wrapAngle(Math.PI / 2 - Math.PI / segmentCount);
  }

  onImpact(listener: (event: PegImpact) => void): () => void {
    this.impactListeners.add(listener);
    return () => this.impactListeners.delete(listener);
  }

  setSegmentCount(count: number): void {
    this.segmentCount = clamp(Math.round(count), 2, 50);
    this.lastPeg = -1;
    this.contactPeg = -1;
  }

  launch(charge: number, random: RandomSource): void {
    const power = Math.pow(clamp(charge, 0, 1), 1.5);
    const targetOmega = (4.2 + power * 23) * random.range(0.94, 1.06);
    this.launchRemaining = random.range(0.065, 0.095);
    this.launchTorque = targetOmega * this.config.wheelInertia / this.launchRemaining;
    this.pointer.angle = random.range(-0.012, 0.012);
    this.pointer.angularVelocity = random.range(-0.08, 0.08);
    this.dragScale = random.range(0.985, 1.015);
    this.restitutionScale = random.range(0.96, 1.04);
    this.lastWheelDirection = 1;
    this.stableTime = 0;
  }

  applyChargeTension(charge: number): void {
    if (Math.abs(this.wheel.angularVelocity) < 0.08) {
      this.wheel.angle = wrapAngle(this.wheel.angle - charge * 0.0007);
      this.pointer.angle = -charge * 0.025;
    }
  }

  step(dt: number): void {
    this.simTime += dt;
    if (this.launchRemaining > 0) {
      const applied = Math.min(dt, this.launchRemaining);
      this.wheel.angularVelocity += this.launchTorque * applied / this.config.wheelInertia;
      this.launchRemaining -= applied;
    }

    const omega = this.wheel.angularVelocity;
    let resistance = -this.config.linearDrag * this.dragScale * omega
      - this.config.quadraticDrag * omega * Math.abs(omega)
      + this.wheelContactTorque;
    const appliedContactTorque = this.wheelContactTorque;
    this.wheelContactTorque = 0;
    if (Math.abs(omega) > 0.0001) {
      resistance -= Math.sign(omega) * this.config.bearingFriction;
    } else if (Math.abs(resistance) <= this.config.bearingFriction) {
      resistance = 0;
    } else {
      resistance -= Math.sign(resistance) * this.config.bearingFriction;
    }
    const previousAngle = this.wheel.angle;
    this.wheel.angularVelocity += resistance / this.config.wheelInertia * dt;
    if (omega !== 0
      && Math.sign(omega) !== Math.sign(this.wheel.angularVelocity)
      && Math.abs(appliedContactTorque) <= this.config.bearingFriction) {
      this.wheel.angularVelocity = 0;
    }
    this.wheel.angle = wrapAngle(this.wheel.angle + this.wheel.angularVelocity * dt);

    this.resolvePegCrossings(previousAngle, this.wheel.angle);

    const contactTorque = this.pegContactTorque();
    const pointerTorque = -this.config.pointerSpring * this.pointer.angle
      - this.config.pointerDamping * this.pointer.angularVelocity
      + contactTorque;
    this.pointer.angularVelocity += pointerTorque / this.config.pointerInertia * dt;
    this.pointer.angle += this.pointer.angularVelocity * dt;
    this.pointer.angle = clamp(this.pointer.angle, -1, 1);
    this.resolvePointerPenetration(dt);

    this.lastImpactStrength *= Math.exp(-dt * 9);
    const pointerHasValidRest = Math.abs(this.pointer.angle) < 0.012
      && this.contactPeg < 0;
    const stopped = Math.abs(this.wheel.angularVelocity) < 0.025
      && Math.abs(this.pointer.angularVelocity) < 0.06
      && pointerHasValidRest
      && this.launchRemaining <= 0;
    this.stableTime = stopped ? this.stableTime + dt : 0;
    if (this.stableTime >= 0.35) this.wheel.angularVelocity = 0;
  }

  /**
   * Models the pointer tip riding up a round peg. Contact is unilateral: a peg
   * can lift the pointer, but it cannot pull it back after passing underneath.
   */
  private pegContactTorque(): number {
    const motionDirection = Math.sign(this.wheel.angularVelocity);
    if (motionDirection !== 0 && this.contactPeg < 0) this.lastWheelDirection = motionDirection;
    const wheelDirection = this.contactPeg >= 0
      ? this.contactDirection
      : (motionDirection || this.lastWheelDirection);

    const step = TAU / this.segmentCount;
    const pointerLine = Math.PI / 2;
    const logicalPeg = Math.round((pointerLine - this.wheel.angle) / step);
    const pegIndex = ((logicalPeg % this.segmentCount) + this.segmentCount) % this.segmentCount;
    const pegAngle = this.wheel.angle + logicalPeg * step;
    const phase = signedAngle(pegAngle - pointerLine);
    // The tip must travel completely across the peg diameter before release.
    // Wider segment spacing permits the full lever excursion; dense wheels
    // scale it down to the available pitch while retaining clear separation.
    const maxDeflection = Math.min(0.52, 0.28 + step * 0.28);

    // Near rest, resolve the geometry symmetrically toward the nearest clear
    // side. This avoids direction-dependent chatter when pins are close.
    if (Math.abs(this.wheel.angularVelocity) < 0.12) {
      // Match the rendered bead/pin separation. Dense wheels must approach
      // half a segment pitch before the pointer is genuinely clear.
      const clearance = Math.min(0.06, step * 0.45);
      if (Math.abs(phase) >= clearance) {
        this.contactPeg = -1;
        return 0;
      }
      if (this.contactPeg !== pegIndex) {
        this.contactPeg = pegIndex;
        this.emitContact(pegIndex);
      }
      const pointerSide = Math.abs(phase) < 1e-5
        ? this.lastWheelDirection
        : Math.sign(phase);
      const detentPhase = Math.min(step * 0.5, clearance + 0.01);
      const targetPhase = Math.abs(phase) < 1e-5
        ? -this.lastWheelDirection * detentPhase
        : Math.sign(phase) * detentPhase;
      const overlap = 1 - Math.abs(phase) / clearance;
      const desiredAngle = -pointerSide * maxDeflection * overlap * overlap;
      const torque = clamp(
        125 * (desiredAngle - this.pointer.angle) - 2 * this.pointer.angularVelocity,
        -35,
        35,
      );
      // Equal-and-opposite reaction from the loaded pointer spring. Near the
      // trailing edge this can gently roll the wheel back instead of always
      // forcing it onward into the next detent.
      const pointerReaction = clamp(
        this.config.pointerSpring * this.pointer.angle * 0.018,
        -0.9,
        0.9,
      );
      this.wheelContactTorque = clamp(
        40 * (targetPhase - phase)
          - 15 * this.wheel.angularVelocity
          + pointerReaction,
        -2.5,
        2.5,
      );
      this.lastPeg = pegIndex;
      return torque;
    }

    const travel = phase * wheelDirection;
    const approach = Math.min(0.14, step * 0.62);
    const release = Math.min(0.06, step * 0.28);
    if (travel <= -approach || travel >= release) {
      this.contactPeg = -1;
      if (motionDirection !== 0) this.lastWheelDirection = motionDirection;
      return 0;
    }

    if (this.contactPeg !== pegIndex) {
      this.contactPeg = pegIndex;
      this.contactDirection = wheelDirection;
      this.emitContact(pegIndex);
    }

    const progress = clamp((travel + approach) / (approach + release), 0, 1);
    const lift = progress * progress * (3 - 2 * progress);
    const desiredAngle = -wheelDirection * maxDeflection * lift;
    const liftDerivative = 6 * progress * (1 - progress);
    const desiredVelocity = -wheelDirection * maxDeflection * liftDerivative
      * Math.abs(this.wheel.angularVelocity) / (approach + release);

    let torque = 125 * (desiredAngle - this.pointer.angle)
      + 1.8 * (desiredVelocity - this.pointer.angularVelocity);
    // The peg may only push in the direction of travel, never glue the pointer
    // to its back face after the contact has released.
    if (torque * wheelDirection > 0) torque = 0;
    torque = clamp(torque, -35, 35);

    // While geometry overlaps, the detent must overcome static bearing
    // friction all the way to the edge of the peg. This prevents a false
    // equilibrium on either flank and guarantees a clear vertical rest.
    const reaction = Math.max(
      Math.abs(torque) * 0.028,
      this.config.bearingFriction + 0.06,
    );
    this.wheelContactTorque = -wheelDirection * reaction;
    this.lastPeg = pegIndex;
    return torque;
  }

  /**
   * Position-level contact correction using the same dimensions as the WGSL
   * meshes. The force model supplies the motion; this constraint guarantees
   * the visible pointer bead can never cut through a visible pin.
   */
  private resolvePointerPenetration(dt:number):void {
    const pegOrbit=0.83;
    const pointerPivotY=0.955;
    const pointerLength=0.145;
    const visibleClearance=0.046; // .027 pin + .014 bead + a small air gap
    const step=TAU/this.segmentCount;
    const nearestLogical=Math.round((Math.PI/2-this.wheel.angle)/step);

    for(let offset=-1;offset<=1;offset++){
      const logicalPeg=nearestLogical+offset;
      const pegIndex=((logicalPeg%this.segmentCount)+this.segmentCount)%this.segmentCount;
      const pegAngle=this.wheel.angle+logicalPeg*step;
      const pegX=Math.cos(pegAngle)*pegOrbit;
      const pegY=Math.sin(pegAngle)*pegOrbit;
      if(this.pointerPinDistance(this.pointer.angle,pegX,pegY,pointerPivotY,pointerLength)>=visibleClearance)continue;

      const startAngle=this.pointer.angle;
      let resolvedAngle=Number.NaN;
      let smallestCorrection=Infinity;
      // Both sides are valid collision exits. Choosing the nearest one lets
      // the pointer ride the leading face, then snap behind the trailing face.
      for(let side=0;side<2;side++){
        const targetAngle=side===0?-1:1;
        let insideAngle=startAngle;
        let outsideAngle=targetAngle;
        let foundOutside=false;
        for(let scan=1;scan<=32;scan++){
          const candidate=startAngle+(targetAngle-startAngle)*scan/32;
          if(this.pointerPinDistance(candidate,pegX,pegY,pointerPivotY,pointerLength)>=visibleClearance){outsideAngle=candidate;foundOutside=true;break;}
          insideAngle=candidate;
        }
        if(!foundOutside)continue;
        for(let iteration=0;iteration<12;iteration++){
          const middle=(insideAngle+outsideAngle)*0.5;
          if(this.pointerPinDistance(middle,pegX,pegY,pointerPivotY,pointerLength)<visibleClearance)insideAngle=middle;
          else outsideAngle=middle;
        }
        const correction=Math.abs(outsideAngle-startAngle);
        if(correction<smallestCorrection){smallestCorrection=correction;resolvedAngle=outsideAngle;}
      }
      if(!Number.isFinite(resolvedAngle))resolvedAngle=-this.lastWheelDirection;

      const correction=resolvedAngle-this.pointer.angle;
      const correctionDirection=Math.sign(correction)||1;
      this.pointer.angle=clamp(resolvedAngle+correctionDirection*0.001,-1,1);
      const wheelSpeed=Math.abs(this.wheel.angularVelocity);
      if(wheelSpeed<0.5){
        // Projection prevents overlap, but it is not an impact. Feeding its
        // full displacement back into velocity creates energy and makes slow
        // contacts kick. At low speed, let the spring/contact forces provide
        // all visible motion and dissipate velocity at the constrained face.
        this.pointer.angularVelocity*=wheelSpeed<0.12?0.12:0.62;
        if(wheelSpeed<0.12){
          // A returning pointer can remain wedged against a pin after the
          // wheel has lost its momentum. Pass that spring load into the wheel
          // so the pin yields gently instead of holding a static deadlock.
          this.wheelContactTorque=correctionDirection
            *(this.config.bearingFriction+0.08);
        }
      }else{
        this.pointer.angularVelocity=clamp(
          this.pointer.angularVelocity+correction/dt*0.035,
          -9,
          9,
        );
      }
      if(this.contactPeg!==pegIndex){this.contactPeg=pegIndex;this.emitContact(pegIndex);}
    }
  }

  private pointerPinDistance(angle:number,pegX:number,pegY:number,pivotY:number,length:number):number {
    const tipX=Math.sin(angle)*length;
    const tipY=pivotY-Math.cos(angle)*length;
    return Math.hypot(tipX-pegX,tipY-pegY);
  }

  private resolvePegCrossings(previous: number, current: number): void {
    const step = TAU / this.segmentCount;
    const delta = signedAngle(current - previous);
    if (Math.abs(delta) < 1e-9) return;
    const direction = Math.sign(delta);
    // The audible click occurs just after the peg crown passes the fixed top
    // line and the pointer is released to strike the trailing face.
    const pointerLine = Math.PI / 2 + direction * Math.min(0.06, step * 0.28);
    const prevPhase = (previous - pointerLine) / step;
    const nextPhase = (previous + delta - pointerLine) / step;
    const from = Math.floor(prevPhase);
    const to = Math.floor(nextPhase);
    if (from === to) return;

    const crossings = Math.min(4, Math.abs(to - from));
    for (let n = 1; n <= crossings; n++) {
      const boundary = direction > 0 ? from + n : from - n + 1;
      const pegIndex = (((-boundary) % this.segmentCount) + this.segmentCount) % this.segmentCount;
      this.collide(pegIndex);
    }
  }

  private collide(pegIndex: number): void {
    if (pegIndex === this.contactPeg) return;
    if (pegIndex === this.lastPeg && this.simTime - this.lastImpactTime < 0.025) return;
    this.lastPeg = pegIndex;
    this.lastImpactTime = this.simTime;
    const relativeSpeed = this.wheel.angularVelocity - this.pointer.angularVelocity * 0.18;
    const strength = clamp(Math.abs(relativeSpeed) / 17, 0.06, 1);
    const direction = Math.sign(relativeSpeed) || 1;
    const pointerImpulse = -direction * (2.5 + 10 * strength) * this.config.collisionRestitution * this.restitutionScale;
    this.pointer.angularVelocity += pointerImpulse;
    this.wheel.angularVelocity -= direction * (0.012 + strength * this.config.collisionCoupling * 0.55);
    this.lastImpactStrength = strength;
    const event: PegImpact = {
      pegIndex, strength, wheelVelocity: this.wheel.angularVelocity, timestamp: this.simTime,
    };
    for (const listener of this.impactListeners) listener(event);
  }

  private emitContact(pegIndex:number):void {
    this.lastPeg=pegIndex; this.lastImpactTime=this.simTime;
    const strength=clamp(Math.abs(this.wheel.angularVelocity)/17,0.06,1);
    this.lastImpactStrength=strength;
    const event:PegImpact={pegIndex,strength,wheelVelocity:this.wheel.angularVelocity,timestamp:this.simTime};
    for(const listener of this.impactListeners)listener(event);
  }

  isSettled(): boolean { return this.stableTime >= 0.35; }

  snapshot(): PhysicsSnapshot {
    return {
      wheel: { ...this.wheel }, pointer: { ...this.pointer }, currentPeg: this.lastPeg,
      lastImpact: this.lastImpactStrength, stableTime: this.stableTime,
    };
  }
}
