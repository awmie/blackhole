module.exports = {

"[project]/src/components/event-horizon/three-blackhole-canvas.tsx [app-ssr] (ecmascript)": ((__turbopack_context__) => {
"use strict";

var { g: global, __dirname } = __turbopack_context__;
{
__turbopack_context__.s({
    "default": (()=>__TURBOPACK__default__export__)
});
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
"use client";
;
;
// Gravitational Constants (tune these for desired simulation behavior)
const G_CONSTANT = 0.05; // Gravitational constant
const BLACK_HOLE_MASS_EQUIVALENT_FACTOR = 200; // Multiplied by radius for mass
const STAR_BASE_MASS = 150; // Base mass for a star of scale 1
const PLANET_BASE_MASS = 0.5; // Base mass for a planet of scale 1
const MIN_GRAVITY_DISTANCE_SQ = 0.01; // To prevent division by zero / extreme forces
const NUM_DISK_PARTICLES = 25000; // Optimized: reduced from 50000 for better performance while maintaining visual quality
const baseAngularSpeed = 1.0; // For accretion disk particles only
const minAngularSpeedFactor = 0.02; // For accretion disk particles only
const photonRingThreshold = 0.03;
const PULL_IN_FACTOR_DISSOLVING_BH = 8.0; // Stronger pull specifically for BH when dissolving
const DISSOLUTION_START_RADIUS_FACTOR = 1.2; // When an object gets this close to BH (factor of BH radius)
const DISSOLUTION_DURATION = 1.5; // Default time to dissolve once triggered
const blackHoleVertexShader = `
varying vec3 v_worldPosition;
varying vec3 v_normal;
varying vec4 v_screenPosition; 

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  v_worldPosition = worldPos.xyz;
  v_normal = normalize(mat3(modelMatrix) * normal);
  
  v_screenPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0); 
  
  gl_Position = v_screenPosition;
}
`;
const blackHoleFragmentShader = `
varying vec3 v_worldPosition;
varying vec3 v_normal;
varying vec4 v_screenPosition;

uniform vec3 u_cameraPosition;

void main() {
  // Simple black hole - just black with fresnel edge
  vec3 normal = normalize(v_normal);
  vec3 viewDir = normalize(u_cameraPosition - v_worldPosition);
  float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 2.0);
  
  gl_FragColor = vec4(vec3(0.0), 1.0);
}
`;
const JET_PARTICLE_COUNT = 10000;
const JET_LIFESPAN = 4.0;
const JET_SPEED = 6;
const JET_PARTICLE_BASE_SIZE = 0.003;
const JET_SPREAD_ANGLE = Math.PI / 16384;
const JET_VELOCITY_RANDOM_OFFSET_MAGNITUDE = 0.0005;
const JET_EMIT_BURST_COUNT = 150;
const STAR_EMITTED_PARTICLE_COUNT = 10000;
const STAR_DISSOLUTION_EMIT_RATE_PER_FRAME = 2;
const STAR_DISSOLUTION_PARTICLE_LIFESPAN = 1.5;
const STAR_DISSOLUTION_PARTICLE_INITIAL_SPEED = 0.3;
const STAR_DISSOLUTION_PARTICLE_GRAVITY_FACTOR = 0.5;
const SHATTER_PARTICLE_POOL_SIZE = 5000;
const SHATTER_PARTICLES_PER_COLLISION = 75;
const SHATTER_PARTICLE_LIFESPAN_MIN = 0.8;
const SHATTER_PARTICLE_LIFESPAN_MAX = 1.8;
const SHATTER_PARTICLE_SPEED_MIN = 0.5;
const SHATTER_PARTICLE_SPEED_MAX = 2.5;
const SHATTER_PARTICLE_SIZE_MIN = 0.0008;
const SHATTER_PARTICLE_SIZE_MAX = 0.002;
const SHATTER_PARTICLE_GRAVITY_FACTOR_BASE = 0.02;
const SHATTER_PARTICLE_NEAR_BH_THRESHOLD_FACTOR = 4.0;
const SHATTER_PARTICLE_GRAVITY_BOOST_NEAR_BH = 25.0;
const SHATTER_PARTICLE_SPIRAL_STRENGTH_NEAR_BH = 0.3;
const SHATTER_PARTICLE_QUICK_ABSORPTION_RADIUS_FACTOR = 1.1;
const SHATTER_PARTICLE_LIFESPAN_REDUCTION_NEAR_ABSORPTION = 8.0;
const NUM_BACKGROUND_STARS = 20000; // Optimized: reduced from 30000 for better performance while maintaining visual depth
// Lensing Shader for post-processing
const LensingShader = {
    uniforms: {
        tDiffuse: {
            value: null
        },
        resolution: {
            value: null
        },
        bhPos: {
            value: null
        },
        bhRadius: {
            value: 0.0
        },
        mass: {
            value: 0.0
        }
    },
    vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
    fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform vec2 bhPos;
    uniform float bhRadius;
    uniform float mass;
    varying vec2 vUv;
    
    void main() {
      vec2 aspectUv = vUv * vec2(resolution.x / resolution.y, 1.0);
      vec2 aspectBh = bhPos * vec2(resolution.x / resolution.y, 1.0);
      
      vec2 toBh = aspectBh - aspectUv;
      float dist = length(toBh);
      
      // Normalize distance by black hole radius
      float r = dist / max(bhRadius, 0.001);
      
      // Define the lensing influence radius (how far the effect reaches)
      float influenceRadius = 4.0; // Only lens within 4x the black hole radius
      
      // Smooth falloff: 1.0 at center, 0.0 at influenceRadius
      float falloff = 1.0 - smoothstep(0.0, influenceRadius, dist);
      
      // Einstein radius is where light from behind gets bent around
      float einsteinR = 1.5;
      
      // Gravitational deflection: stronger near the black hole
      float deflection = 3.0 / (r + 0.1);
      deflection = min(deflection, 5.0);
      
      // Apply falloff so lensing fades to zero far from black hole
      deflection *= falloff;
      
      // Extra boost at Einstein radius for the ring effect
      float ringDist = abs(r - einsteinR);
      float nearEinstein = smoothstep(0.8, 0.0, ringDist) * falloff;
      deflection += nearEinstein * 2.0;
      
      vec2 offset = normalize(toBh) * deflection * bhRadius * 0.5;
      offset.x /= resolution.x / resolution.y;
      
      // Sample the background with displacement
      vec4 color = texture2D(tDiffuse, vUv + offset);
      
      // Black hole shadow - completely black inside event horizon
      if (dist < bhRadius) {
        color = vec4(0.0, 0.0, 0.0, 1.0);
      } else {
        // Brighten the Einstein ring where the bent accretion disk appears
        float ringIntensity = exp(-ringDist * ringDist * 8.0) * 1.5 * falloff;
        color.rgb *= 1.0 + ringIntensity;
        
        // Slight warm tint in the ring from the accretion disk
        vec3 diskColor = vec3(1.0, 0.8, 0.4);
        color.rgb = mix(color.rgb, diskColor, ringIntensity * 0.3);
      }
      
      gl_FragColor = color;
    }
  `
};
const ThreeBlackholeCanvas = ({ blackHoleRadius, accretionDiskInnerRadius, accretionDiskOuterRadius, accretionDiskOpacity, onCameraUpdate, spawnedPlanets, onAbsorbPlanet, onSetPlanetDissolving, isEmittingJets, onCameraReady, onShiftClickSpawnAtPoint, onStarMassLoss, onUpdatePlanetPosition, collisionEvents, onCollisionEventProcessed, simulationSpeed })=>{
    const mountRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const rendererRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const foregroundSceneRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const backgroundSceneRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const cameraRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const controlsRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const composerRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const lensingPassRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const blackHoleRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const blackHoleMaterialRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const accretionDiskRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const starsRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const starTwinkleDataRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])([]);
    const clockRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const diskParticleDataRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])([]); // Accretion disk specific
    const celestialObjectsRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(new Map()); // Renamed from planetMeshesRef
    const dissolvingObjectsProgressRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(new Map());
    const evolvingObjectDataRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(new Map()); // Renamed
    const jetParticlesRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const jetParticleDataRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])([]);
    const jetMaterialRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const lastJetParticleIndexRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(0);
    const starEmittedParticlesRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const starEmittedParticleDataRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])([]);
    const starEmittedParticleMaterialRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const lastStarEmittedParticleIndexRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(0);
    const shatterParticlesRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const shatterParticleDataRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])([]);
    const shatterParticleMaterialRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const lastShatterParticleIndexRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(0);
    const sceneCaptureRenderTargetRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const tempVectorRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const tempVector2Ref = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null); // For gravity calculations
    const tempQuaternionRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const THREEInstanceRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const onShiftClickSpawnAtPointRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(onShiftClickSpawnAtPoint);
    const onCameraUpdateRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(onCameraUpdate);
    const onAbsorbPlanetRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(onAbsorbPlanet);
    const onSetPlanetDissolvingRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(onSetPlanetDissolving);
    const onStarMassLossRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(onStarMassLoss);
    const onUpdatePlanetPositionRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(onUpdatePlanetPosition);
    const collisionEventsRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(collisionEvents);
    const onCollisionEventProcessedRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(onCollisionEventProcessed);
    const spawnedObjectsRef_anim = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(spawnedPlanets); // Renamed from spawnedPlanetsRef_anim
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        spawnedObjectsRef_anim.current = spawnedPlanets;
    }, [
        spawnedPlanets
    ]);
    const isEmittingJetsRef_anim = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(isEmittingJets);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        isEmittingJetsRef_anim.current = isEmittingJets;
    }, [
        isEmittingJets
    ]);
    const blackHoleRadiusRef_anim = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(blackHoleRadius);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        blackHoleRadiusRef_anim.current = blackHoleRadius;
    }, [
        blackHoleRadius
    ]);
    const simulationSpeedRef_anim = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(simulationSpeed);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        simulationSpeedRef_anim.current = simulationSpeed;
    }, [
        simulationSpeed
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        onShiftClickSpawnAtPointRef.current = onShiftClickSpawnAtPoint;
    }, [
        onShiftClickSpawnAtPoint
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        onCameraUpdateRef.current = onCameraUpdate;
    }, [
        onCameraUpdate
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        onAbsorbPlanetRef.current = onAbsorbPlanet;
    }, [
        onAbsorbPlanet
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        onSetPlanetDissolvingRef.current = onSetPlanetDissolving;
    }, [
        onSetPlanetDissolving
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        onStarMassLossRef.current = onStarMassLoss;
    }, [
        onStarMassLoss
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        onUpdatePlanetPositionRef.current = onUpdatePlanetPosition;
    }, [
        onUpdatePlanetPosition
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        collisionEventsRef.current = collisionEvents;
    }, [
        collisionEvents
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        onCollisionEventProcessedRef.current = onCollisionEventProcessed;
    }, [
        onCollisionEventProcessed
    ]);
    const createAndAddAccretionParticles = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((innerR, outerR, opacity)=>{
        const THREE = THREEInstanceRef.current;
        const scene = foregroundSceneRef.current;
        if (!THREE || !scene) return;
        if (accretionDiskRef.current) {
            scene.remove(accretionDiskRef.current);
            accretionDiskRef.current.geometry.dispose();
            accretionDiskRef.current.material.dispose();
            accretionDiskRef.current = null;
        }
        const particlesGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(NUM_DISK_PARTICLES * 3);
        const colors = new Float32Array(NUM_DISK_PARTICLES * 4);
        diskParticleDataRef.current = [];
        const colorInner = new THREE.Color(1.0, 0.4, 0.8);
        const colorMid = new THREE.Color(0.6, 0.3, 0.9);
        const colorOuter = new THREE.Color(0.2, 0.1, 0.7);
        const colorPhotonRing = new THREE.Color(1.0, 0.95, 0.85);
        const outerFadeStartNormalized = 0.7;
        for(let i = 0; i < NUM_DISK_PARTICLES; i++){
            const i3 = i * 3;
            const i4 = i * 4;
            const radius = Math.random() * (outerR - innerR) + innerR;
            const angle = Math.random() * Math.PI * 2;
            const yOffset = (Math.random() - 0.5) * 0.1;
            let normalizedDist = (radius - innerR) / (outerR - innerR);
            normalizedDist = Math.max(0, Math.min(1, normalizedDist));
            let angularVelocity = baseAngularSpeed * Math.pow(innerR / radius, 2.5);
            angularVelocity = Math.max(angularVelocity, baseAngularSpeed * minAngularSpeedFactor);
            diskParticleDataRef.current.push({
                radius,
                angle,
                angularVelocity,
                yOffset
            });
            positions[i3] = radius * Math.cos(angle);
            positions[i3 + 1] = yOffset;
            positions[i3 + 2] = radius * Math.sin(angle);
            const particleColor = new THREE.Color();
            if (normalizedDist < 0.5) {
                particleColor.lerpColors(colorInner, colorMid, normalizedDist * 2.0);
            } else {
                particleColor.lerpColors(colorMid, colorOuter, (normalizedDist - 0.5) * 2.0);
            }
            if (normalizedDist < photonRingThreshold) {
                let photonRingIntensity = (photonRingThreshold - normalizedDist) / photonRingThreshold;
                photonRingIntensity = Math.pow(photonRingIntensity, 1.5);
                particleColor.lerp(colorPhotonRing, photonRingIntensity);
                particleColor.r = Math.min(1.0, particleColor.r + photonRingIntensity * 2.5);
                particleColor.g = Math.min(1.0, particleColor.g + photonRingIntensity * 2.5);
                particleColor.b = Math.min(1.0, particleColor.b + photonRingIntensity * 2.5);
            } else {
                const innerEdgeFactor = 1.0 - Math.min(1.0, Math.max(0.0, (normalizedDist - photonRingThreshold) / 0.15));
                if (innerEdgeFactor > 0) {
                    particleColor.r = Math.min(1.0, particleColor.r + innerEdgeFactor * 0.8);
                    particleColor.g = Math.min(1.0, particleColor.g + innerEdgeFactor * 0.8);
                    particleColor.b = Math.min(1.0, particleColor.b + innerEdgeFactor * 0.8);
                }
            }
            colors[i4] = particleColor.r;
            colors[i4 + 1] = particleColor.g;
            colors[i4 + 2] = particleColor.b;
            let particleAlpha = opacity;
            if (normalizedDist > outerFadeStartNormalized) {
                particleAlpha *= 1.0 - (normalizedDist - outerFadeStartNormalized) / (1.0 - outerFadeStartNormalized);
            }
            colors[i4 + 3] = Math.max(0.0, Math.min(1.0, particleAlpha));
        }
        particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        particlesGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
        const particlesMaterial = new THREE.PointsMaterial({
            size: 0.01,
            vertexColors: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true
        });
        const newDisk = new THREE.Points(particlesGeometry, particlesMaterial);
        scene.add(newDisk);
        accretionDiskRef.current = newDisk;
    }, []);
    const initJetParticles = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>{
        const THREE = THREEInstanceRef.current;
        const scene = foregroundSceneRef.current;
        if (!THREE || !scene) return;
        if (jetParticlesRef.current) {
            scene.remove(jetParticlesRef.current);
            jetParticlesRef.current.geometry.dispose();
            if (jetParticlesRef.current.material instanceof THREE.Material) {
                jetParticlesRef.current.material.dispose();
            }
            jetParticlesRef.current = null;
        }
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(JET_PARTICLE_COUNT * 3);
        const colorsAttribute = new Float32Array(JET_PARTICLE_COUNT * 3);
        const sizesAttribute = new Float32Array(JET_PARTICLE_COUNT);
        jetParticleDataRef.current = [];
        for(let i = 0; i < JET_PARTICLE_COUNT; i++){
            jetParticleDataRef.current.push({
                id: i,
                position: new THREE.Vector3(0, -1000, 0),
                velocity: new THREE.Vector3(),
                life: 0,
                initialLife: JET_LIFESPAN,
                color: new THREE.Color(1, 1, 1),
                size: JET_PARTICLE_BASE_SIZE,
                active: false
            });
            positions[i * 3] = 0;
            positions[i * 3 + 1] = -1000;
            positions[i * 3 + 2] = 0;
            colorsAttribute[i * 3] = 1;
            colorsAttribute[i * 3 + 1] = 1;
            colorsAttribute[i * 3 + 2] = 1;
            sizesAttribute[i] = JET_PARTICLE_BASE_SIZE;
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorsAttribute, 3));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizesAttribute, 1));
        jetMaterialRef.current = new THREE.PointsMaterial({
            vertexColors: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true
        });
        jetParticlesRef.current = new THREE.Points(geometry, jetMaterialRef.current);
        jetParticlesRef.current.visible = true;
        jetParticlesRef.current.frustumCulled = false;
        scene.add(jetParticlesRef.current);
        lastJetParticleIndexRef.current = 0;
    }, []);
    const initStarEmittedParticles = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>{
        const THREE = THREEInstanceRef.current;
        const scene = foregroundSceneRef.current;
        if (!THREE || !scene) return;
        if (starEmittedParticlesRef.current) {
            scene.remove(starEmittedParticlesRef.current);
            starEmittedParticlesRef.current.geometry.dispose();
            if (starEmittedParticlesRef.current.material instanceof THREE.Material) {
                starEmittedParticlesRef.current.material.dispose();
            }
            starEmittedParticlesRef.current = null;
        }
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(STAR_EMITTED_PARTICLE_COUNT * 3);
        const colorsAttribute = new Float32Array(STAR_EMITTED_PARTICLE_COUNT * 3);
        const sizesAttribute = new Float32Array(STAR_EMITTED_PARTICLE_COUNT);
        starEmittedParticleDataRef.current = [];
        for(let i = 0; i < STAR_EMITTED_PARTICLE_COUNT; i++){
            starEmittedParticleDataRef.current.push({
                id: i,
                position: new THREE.Vector3(0, -1000, 0),
                velocity: new THREE.Vector3(),
                life: 0,
                initialLife: STAR_DISSOLUTION_PARTICLE_LIFESPAN,
                color: new THREE.Color(1, 1, 1),
                size: 0.0005,
                active: false
            });
            const i3 = i * 3;
            positions[i3] = 0;
            positions[i3 + 1] = -1000;
            positions[i3 + 2] = 0;
            colorsAttribute[i3] = 1;
            colorsAttribute[i3 + 1] = 1;
            colorsAttribute[i3 + 2] = 1;
            sizesAttribute[i] = 0.0005;
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorsAttribute, 3));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizesAttribute, 1));
        starEmittedParticleMaterialRef.current = new THREE.PointsMaterial({
            vertexColors: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true
        });
        starEmittedParticlesRef.current = new THREE.Points(geometry, starEmittedParticleMaterialRef.current);
        starEmittedParticlesRef.current.visible = true;
        starEmittedParticlesRef.current.frustumCulled = false;
        scene.add(starEmittedParticlesRef.current);
        lastStarEmittedParticleIndexRef.current = 0;
    }, []);
    const initShatterParticles = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>{
        const THREE = THREEInstanceRef.current;
        const scene = foregroundSceneRef.current;
        if (!THREE || !scene) return;
        if (shatterParticlesRef.current) {
            scene.remove(shatterParticlesRef.current);
            shatterParticlesRef.current.geometry.dispose();
            if (shatterParticlesRef.current.material instanceof THREE.Material) {
                shatterParticlesRef.current.material.dispose();
            }
            shatterParticlesRef.current = null;
        }
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(SHATTER_PARTICLE_POOL_SIZE * 3);
        const colorsAttribute = new Float32Array(SHATTER_PARTICLE_POOL_SIZE * 3);
        const sizesAttribute = new Float32Array(SHATTER_PARTICLE_POOL_SIZE);
        shatterParticleDataRef.current = [];
        for(let i = 0; i < SHATTER_PARTICLE_POOL_SIZE; i++){
            shatterParticleDataRef.current.push({
                id: i,
                position: new THREE.Vector3(0, -1000, 0),
                velocity: new THREE.Vector3(),
                life: 0,
                initialLife: 1,
                color: new THREE.Color(1, 1, 1),
                size: 0.01,
                active: false
            });
            positions[i * 3] = 0;
            positions[i * 3 + 1] = -1000;
            positions[i * 3 + 2] = 0;
            colorsAttribute[i * 3] = 1;
            colorsAttribute[i * 3 + 1] = 1;
            colorsAttribute[i * 3 + 2] = 1;
            sizesAttribute[i] = 0.01;
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorsAttribute, 3));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizesAttribute, 1));
        shatterParticleMaterialRef.current = new THREE.PointsMaterial({
            vertexColors: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true
        });
        shatterParticlesRef.current = new THREE.Points(geometry, shatterParticleMaterialRef.current);
        shatterParticlesRef.current.visible = true;
        shatterParticlesRef.current.frustumCulled = false;
        scene.add(shatterParticlesRef.current);
        lastShatterParticleIndexRef.current = 0;
    }, []);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        const foregroundScene = foregroundSceneRef.current;
        if (!foregroundScene || !THREEInstanceRef.current) return;
        initJetParticles();
        initStarEmittedParticles();
        initShatterParticles();
    }, [
        initJetParticles,
        initStarEmittedParticles,
        initShatterParticles
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (!mountRef.current) return;
        const LocalTHREE = __turbopack_context__.r("[project]/node_modules/three/build/three.cjs [app-ssr] (ecmascript)");
        THREEInstanceRef.current = LocalTHREE;
        const THREE = THREEInstanceRef.current;
        if (!THREE) return;
        tempVectorRef.current = new THREE.Vector3();
        tempVector2Ref.current = new THREE.Vector3();
        tempQuaternionRef.current = new THREE.Quaternion();
        const { OrbitControls } = __turbopack_context__.r("[project]/node_modules/three/examples/jsm/controls/OrbitControls.js [app-ssr] (ecmascript)");
        const { EffectComposer } = __turbopack_context__.r("[project]/node_modules/three/examples/jsm/postprocessing/EffectComposer.js [app-ssr] (ecmascript)");
        const { RenderPass } = __turbopack_context__.r("[project]/node_modules/three/examples/jsm/postprocessing/RenderPass.js [app-ssr] (ecmascript)");
        const { ShaderPass } = __turbopack_context__.r("[project]/node_modules/three/examples/jsm/postprocessing/ShaderPass.js [app-ssr] (ecmascript)");
        if (!clockRef.current) {
            clockRef.current = new THREE.Clock();
        }
        foregroundSceneRef.current = new THREE.Scene();
        backgroundSceneRef.current = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, mountRef.current.clientWidth / mountRef.current.clientHeight, 0.1, 1000);
        camera.position.set(0, blackHoleRadiusRef_anim.current * 1.5, blackHoleRadiusRef_anim.current * 4);
        cameraRef.current = camera;
        if (onCameraReady) {
            onCameraReady(camera);
        }
        if (onCameraUpdateRef.current) {
            onCameraUpdateRef.current({
                x: camera.position.x,
                y: camera.position.y,
                z: camera.position.z
            });
        }
        const renderer = new THREE.WebGLRenderer({
            antialias: true
        });
        renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.autoClear = false;
        mountRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;
        // Setup EffectComposer for post-processing
        const composer = new EffectComposer(renderer);
        composerRef.current = composer;
        // Render everything (stars, accretion disk, planets) in one pass
        // Stars are now in foregroundScene so they get lensed along with everything else
        const renderPass = new RenderPass(foregroundSceneRef.current, camera);
        composer.addPass(renderPass);
        // Add lensing pass - bends everything around the black hole position
        const lensingPass = new ShaderPass(LensingShader);
        lensingPass.uniforms.resolution.value = new THREE.Vector2(mountRef.current.clientWidth * window.devicePixelRatio, mountRef.current.clientHeight * window.devicePixelRatio);
        lensingPass.uniforms.bhPos.value = new THREE.Vector2(0.5, 0.5);
        lensingPassRef.current = lensingPass;
        composer.addPass(lensingPass);
        // Render black hole on top after lensing (in animate loop)
        sceneCaptureRenderTargetRef.current = new THREE.WebGLRenderTarget(mountRef.current.clientWidth * window.devicePixelRatio, mountRef.current.clientHeight * window.devicePixelRatio);
        if (sceneCaptureRenderTargetRef.current) {
            sceneCaptureRenderTargetRef.current.texture.minFilter = THREE.LinearFilter;
            sceneCaptureRenderTargetRef.current.texture.magFilter = THREE.LinearFilter;
            sceneCaptureRenderTargetRef.current.texture.wrapS = THREE.ClampToEdgeWrapping;
            sceneCaptureRenderTargetRef.current.texture.wrapT = THREE.ClampToEdgeWrapping;
        }
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.screenSpacePanning = false;
        controls.minDistance = blackHoleRadiusRef_anim.current * 1.2;
        controls.maxDistance = 80;
        controlsRef.current = controls;
        controls.addEventListener('change', ()=>{
            if (cameraRef.current && onCameraUpdateRef.current) {
                onCameraUpdateRef.current({
                    x: cameraRef.current.position.x,
                    y: cameraRef.current.position.y,
                    z: cameraRef.current.position.z
                });
            }
        });
        const blackHoleGeometry = new THREE.SphereGeometry(1, 64, 64); // Radius 1, scaled by blackHoleRadius prop
        blackHoleMaterialRef.current = new THREE.ShaderMaterial({
            vertexShader: blackHoleVertexShader,
            fragmentShader: blackHoleFragmentShader,
            uniforms: {
                u_cameraPosition: {
                    value: camera.position
                }
            }
        });
        const blackHoleMesh = new THREE.Mesh(blackHoleGeometry, blackHoleMaterialRef.current);
        blackHoleMesh.position.set(0, 0, 0); // Black hole at origin
        foregroundSceneRef.current.add(blackHoleMesh);
        blackHoleRef.current = blackHoleMesh;
        createAndAddAccretionParticles(accretionDiskInnerRadius, accretionDiskOuterRadius, accretionDiskOpacity);
        const starsGeometry = new THREE.BufferGeometry();
        const starVertices = [];
        const starInitialSizes = [];
        starTwinkleDataRef.current = [];
        for(let i = 0; i < NUM_BACKGROUND_STARS; i++){
            const r = 200 + Math.random() * 600;
            const phi = Math.random() * Math.PI * 2;
            const theta = Math.random() * Math.PI;
            starVertices.push(r * Math.sin(theta) * Math.cos(phi), r * Math.sin(theta) * Math.sin(phi), r * Math.cos(theta));
            const initialSize = 2.0 + Math.random() * 3.0; // Range 2.0 to 5.0 - larger for visibility
            starInitialSizes.push(initialSize);
            starTwinkleDataRef.current.push({
                initialSize: initialSize,
                phase: Math.random() * Math.PI * 2,
                speed: 0.3 + Math.random() * 0.7
            });
        }
        starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
        starsGeometry.setAttribute('size', new THREE.Float32BufferAttribute(starInitialSizes, 1));
        // Use shader material for stars to properly handle size attribute and twinkling
        const starsMaterial = new THREE.ShaderMaterial({
            uniforms: {
                color: {
                    value: new THREE.Color(0xffffff)
                },
                time: {
                    value: 0
                }
            },
            vertexShader: `
        attribute float size;
        varying float vAlpha;
        void main() {
          vAlpha = 1.0;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
            fragmentShader: `
        uniform vec3 color;
        varying float vAlpha;
        void main() {
          // Circular soft particle
          vec2 coord = gl_PointCoord - vec2(0.5);
          float dist = length(coord);
          if (dist > 0.5) discard;
          float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
          gl_FragColor = vec4(color, alpha);
        }
      `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        starsRef.current = new THREE.Points(starsGeometry, starsMaterial);
        starsRef.current.frustumCulled = false;
        // Add stars to FOREGROUND scene so they get lensed with everything else
        foregroundSceneRef.current.add(starsRef.current);
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        foregroundSceneRef.current.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        directionalLight.position.set(5, 10, 7.5);
        foregroundSceneRef.current.add(directionalLight);
        if (!jetParticlesRef.current) initJetParticles();
        if (!starEmittedParticlesRef.current) initStarEmittedParticles();
        if (!shatterParticlesRef.current) initShatterParticles();
        const currentRendererDomElement = renderer.domElement;
        const handleCanvasShiftClick = (event)=>{
            const THREE_INSTANCE = THREEInstanceRef.current;
            if (!event.shiftKey || !cameraRef.current || !onShiftClickSpawnAtPointRef.current || !THREE_INSTANCE) return;
            event.preventDefault();
            event.stopPropagation();
            const rect = currentRendererDomElement.getBoundingClientRect();
            const mouse = new THREE_INSTANCE.Vector2();
            mouse.x = (event.clientX - rect.left) / rect.width * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            const raycaster = new THREE_INSTANCE.Raycaster();
            raycaster.setFromCamera(mouse, cameraRef.current);
            const plane = new THREE_INSTANCE.Plane(new THREE_INSTANCE.Vector3(0, 1, 0), 0); // Assume spawn on XZ plane for now
            const intersectionPoint = new THREE_INSTANCE.Vector3();
            if (raycaster.ray.intersectPlane(plane, intersectionPoint)) {
                onShiftClickSpawnAtPointRef.current(intersectionPoint);
            }
        };
        currentRendererDomElement.addEventListener('pointerdown', handleCanvasShiftClick);
        let animationFrameId;
        const animate = ()=>{
            animationFrameId = requestAnimationFrame(animate);
            const THREE_ANIM = THREEInstanceRef.current;
            const renderer_anim = rendererRef.current;
            const fgScene_anim = foregroundSceneRef.current;
            const mainCam_anim = cameraRef.current;
            const bhMaterial_anim = blackHoleMaterialRef.current;
            const bh_anim = blackHoleRef.current;
            const _tempVec = tempVectorRef.current;
            const _tempVec2 = tempVector2Ref.current; // For gravity
            const _tempQuat = tempQuaternionRef.current;
            if (!clockRef.current || !THREE_ANIM || !renderer_anim || !fgScene_anim || !mainCam_anim || !bhMaterial_anim || !bh_anim || !_tempVec || !_tempVec2 || !_tempQuat) return;
            const deltaTime = clockRef.current.getDelta();
            const elapsedTime = clockRef.current.getElapsedTime();
            const effectiveDeltaTime = deltaTime * simulationSpeedRef_anim.current;
            controlsRef.current?.update();
            // Update black hole material camera position
            bhMaterial_anim.uniforms.u_cameraPosition.value.copy(mainCam_anim.position);
            // Update lensing pass uniforms
            if (lensingPassRef.current) {
                const lensingPass = lensingPassRef.current;
                // Project black hole position to screen space
                const bhPos = bh_anim.position.clone();
                const vector = bhPos.project(mainCam_anim);
                const screenX = (vector.x + 1) / 2;
                const screenY = (vector.y + 1) / 2;
                // Calculate screen-space radius based on distance to camera
                // This ensures consistent size when rotating around the black hole
                const distance = bhPos.distanceTo(mainCam_anim.position);
                const fov = mainCam_anim.fov * (Math.PI / 180); // Convert to radians
                const screenHeight = 2 * Math.tan(fov / 2) * distance;
                const screenRadius = blackHoleRadiusRef_anim.current / screenHeight * 0.5; // 0.5 because project() maps to 0-1
                lensingPass.uniforms.bhPos.value.set(screenX, screenY);
                lensingPass.uniforms.bhRadius.value = screenRadius;
                lensingPass.uniforms.mass.value = blackHoleRadiusRef_anim.current * 25; // Stronger mass for better lensing
            }
            // Accretion disk animation
            if (accretionDiskRef.current?.geometry) {
                const positions = accretionDiskRef.current.geometry.attributes.position.array;
                for(let i = 0; i < diskParticleDataRef.current.length; i++){
                    const pData = diskParticleDataRef.current[i];
                    pData.angle += pData.angularVelocity * effectiveDeltaTime;
                    const i3 = i * 3;
                    positions[i3] = pData.radius * Math.cos(pData.angle);
                    positions[i3 + 2] = pData.radius * Math.sin(pData.angle);
                }
                accretionDiskRef.current.geometry.attributes.position.needsUpdate = true;
            }
            // Background stars twinkling animation
            if (starsRef.current?.geometry) {
                const sizes = starsRef.current.geometry.attributes.size;
                const twinkleData = starTwinkleDataRef.current;
                if (sizes && twinkleData.length === NUM_BACKGROUND_STARS) {
                    for(let i = 0; i < NUM_BACKGROUND_STARS; i++){
                        const data = twinkleData[i];
                        const scale = 0.6 + Math.sin(elapsedTime * data.speed + data.phase) * 0.4; // Modulates between 0.2 and 1.0
                        sizes.array[i] = data.initialSize * Math.max(0.1, scale); // Ensure size is positive
                    }
                    sizes.needsUpdate = true;
                }
            }
            // N-body physics for spawned objects
            spawnedObjectsRef_anim.current.forEach((objProp)=>{
                const object3D = celestialObjectsRef.current.get(objProp.id);
                let evolvingData = evolvingObjectDataRef.current.get(objProp.id);
                if (!object3D || !evolvingData) return;
                evolvingData.ttl -= deltaTime; // TTL uses raw deltaTime
                const blackHoleActualRadius = blackHoleRadiusRef_anim.current;
                const currentStarMassFactor = (objProp.type === 'star' ? objProp.currentMassFactor : 1.0) ?? 1.0;
                if (objProp.isDissolving) {
                    let progress = dissolvingObjectsProgressRef.current.get(objProp.id) || 0;
                    progress += deltaTime / (objProp.timeToLive > 0 ? objProp.timeToLive : DISSOLUTION_DURATION);
                    progress = Math.min(progress, 1);
                    dissolvingObjectsProgressRef.current.set(objProp.id, progress);
                    const scaleFactor = 1 - progress;
                    object3D.scale.set(objProp.initialScale.x * currentStarMassFactor * scaleFactor, objProp.initialScale.y * currentStarMassFactor * scaleFactor, objProp.initialScale.z * currentStarMassFactor * scaleFactor);
                    // Simplified pull towards black hole when dissolving
                    _tempVec.copy(bh_anim.position).sub(evolvingData.position).normalize();
                    evolvingData.velocity.addScaledVector(_tempVec, PULL_IN_FACTOR_DISSOLVING_BH * blackHoleActualRadius * effectiveDeltaTime * (0.5 + progress * 1.5));
                    evolvingData.position.addScaledVector(evolvingData.velocity, effectiveDeltaTime);
                    if (objProp.type === 'star' && starEmittedParticlesRef.current && starEmittedParticleDataRef.current.length > 0 && object3D) {
                        const starColor = new THREE_ANIM.Color(objProp.color);
                        for(let i = 0; i < STAR_DISSOLUTION_EMIT_RATE_PER_FRAME; i++){
                            const pIndex = lastStarEmittedParticleIndexRef.current;
                            const particle = starEmittedParticleDataRef.current[pIndex];
                            if (particle && !particle.active) {
                                particle.active = true;
                                particle.position.copy(object3D.position);
                                const randomDirection = new THREE_ANIM.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
                                particle.velocity.copy(randomDirection).multiplyScalar(STAR_DISSOLUTION_PARTICLE_INITIAL_SPEED);
                                particle.life = 1.0;
                                particle.initialLife = STAR_DISSOLUTION_PARTICLE_LIFESPAN + Math.random() * 0.1;
                                particle.color.copy(starColor);
                                particle.size = (0.0005 + Math.random() * 0.0005) * Math.min(1.0, currentStarMassFactor * 0.5 + 0.5);
                            }
                            lastStarEmittedParticleIndexRef.current = (pIndex + 1) % STAR_EMITTED_PARTICLE_COUNT;
                        }
                    }
                    if (progress >= 1 || evolvingData.position.lengthSq() < blackHoleActualRadius * blackHoleActualRadius * 0.01) {
                        if (onAbsorbPlanetRef.current) onAbsorbPlanetRef.current(objProp.id);
                        evolvingObjectDataRef.current.delete(objProp.id);
                        dissolvingObjectsProgressRef.current.delete(objProp.id);
                    }
                } else {
                    // N-body gravitational physics for non-dissolving objects
                    const acceleration = _tempVec2.set(0, 0, 0);
                    const currentMass = objProp.type === 'star' ? STAR_BASE_MASS * currentStarMassFactor : PLANET_BASE_MASS * (objProp.initialScale.x / 0.1);
                    // Gravity from Black Hole
                    const blackHoleEffectiveMass = BLACK_HOLE_MASS_EQUIVALENT_FACTOR * blackHoleActualRadius;
                    _tempVec.copy(bh_anim.position).sub(evolvingData.position);
                    let distSqToBH = _tempVec.lengthSq();
                    distSqToBH = Math.max(distSqToBH, MIN_GRAVITY_DISTANCE_SQ + blackHoleActualRadius * blackHoleActualRadius);
                    const forceMagBH = G_CONSTANT * blackHoleEffectiveMass * currentMass / distSqToBH;
                    acceleration.addScaledVector(_tempVec.normalize(), forceMagBH / currentMass);
                    // Gravity from other Stars
                    spawnedObjectsRef_anim.current.forEach((otherObjProp)=>{
                        if (otherObjProp.id !== objProp.id && otherObjProp.type === 'star' && !otherObjProp.isDissolving) {
                            const otherObject3D = celestialObjectsRef.current.get(otherObjProp.id);
                            const otherEvolvingData = evolvingObjectDataRef.current.get(otherObjProp.id);
                            if (otherObject3D && otherEvolvingData) {
                                const otherStarMass = STAR_BASE_MASS * (otherObjProp.currentMassFactor || 1.0);
                                _tempVec.copy(otherEvolvingData.position).sub(evolvingData.position);
                                let distSqToOther = _tempVec.lengthSq();
                                distSqToOther = Math.max(distSqToOther, MIN_GRAVITY_DISTANCE_SQ);
                                const forceMagOther = G_CONSTANT * otherStarMass * currentMass / distSqToOther;
                                acceleration.addScaledVector(_tempVec.normalize(), forceMagOther / currentMass);
                            }
                        }
                    });
                    evolvingData.velocity.addScaledVector(acceleration, effectiveDeltaTime);
                    evolvingData.position.addScaledVector(evolvingData.velocity, effectiveDeltaTime);
                    if (evolvingData.position.lengthSq() < blackHoleActualRadius * DISSOLUTION_START_RADIUS_FACTOR * blackHoleActualRadius * DISSOLUTION_START_RADIUS_FACTOR && onSetPlanetDissolvingRef.current) {
                        onSetPlanetDissolvingRef.current(objProp.id, true);
                    } else if (evolvingData.ttl <= 0 || evolvingData.position.lengthSq() < blackHoleActualRadius * blackHoleActualRadius * 0.01) {
                        if (onAbsorbPlanetRef.current) onAbsorbPlanetRef.current(objProp.id);
                        evolvingObjectDataRef.current.delete(objProp.id);
                        dissolvingObjectsProgressRef.current.delete(objProp.id);
                    }
                }
                object3D.position.copy(evolvingData.position);
                object3D.scale.set(objProp.initialScale.x * currentStarMassFactor * (objProp.isDissolving ? 1 - (dissolvingObjectsProgressRef.current.get(objProp.id) || 0) : 1), objProp.initialScale.y * currentStarMassFactor * (objProp.isDissolving ? 1 - (dissolvingObjectsProgressRef.current.get(objProp.id) || 0) : 1), objProp.initialScale.z * currentStarMassFactor * (objProp.isDissolving ? 1 - (dissolvingObjectsProgressRef.current.get(objProp.id) || 0) : 1));
                if (evolvingData.velocity.lengthSq() > 0.001 && !objProp.isDissolving) {
                    _tempVec.copy(evolvingData.position).add(evolvingData.velocity);
                    object3D.lookAt(_tempVec);
                } else if (objProp.isDissolving) {
                    object3D.quaternion.slerp(_tempQuat.setFromUnitVectors(new THREE_ANIM.Vector3(0, 0, 1), new THREE_ANIM.Vector3(0, 0, 1)), 0.1);
                }
                if (onUpdatePlanetPositionRef.current) {
                    onUpdatePlanetPositionRef.current(objProp.id, {
                        x: evolvingData.position.x,
                        y: evolvingData.position.y,
                        z: evolvingData.position.z
                    }, {
                        x: evolvingData.velocity.x,
                        y: evolvingData.velocity.y,
                        z: evolvingData.velocity.z
                    });
                }
            });
            // Star emitted particles update
            if (starEmittedParticlesRef.current?.geometry && starEmittedParticleMaterialRef.current && starEmittedParticleDataRef.current.length > 0 && THREE_ANIM) {
                const positions = starEmittedParticlesRef.current.geometry.attributes.position.array;
                const colors = starEmittedParticlesRef.current.geometry.attributes.color.array;
                const sizes = starEmittedParticlesRef.current.geometry.attributes.size.array;
                let hasActiveStarParticles = false;
                starEmittedParticleDataRef.current.forEach((p, i)=>{
                    if (p.active && p.life > 0) {
                        hasActiveStarParticles = true;
                        _tempVec.copy(bh_anim.position).sub(p.position);
                        const distanceSq = Math.max(0.1, p.position.lengthSq());
                        const gravityFactor = STAR_DISSOLUTION_PARTICLE_GRAVITY_FACTOR;
                        _tempVec.normalize().multiplyScalar(gravityFactor / distanceSq);
                        p.velocity.addScaledVector(_tempVec, effectiveDeltaTime);
                        p.position.addScaledVector(p.velocity, effectiveDeltaTime);
                        p.life -= deltaTime / p.initialLife;
                        const i3 = i * 3;
                        positions[i3] = p.position.x;
                        positions[i3 + 1] = p.position.y;
                        positions[i3 + 2] = p.position.z;
                        const fade = Math.max(0, p.life);
                        colors[i3] = p.color.r * fade;
                        colors[i3 + 1] = p.color.g * fade;
                        colors[i3 + 2] = p.color.b * fade;
                        sizes[i] = p.size * fade;
                        if (p.life <= 0 || p.position.lengthSq() < blackHoleRadiusRef_anim.current * blackHoleRadiusRef_anim.current * 0.01) {
                            p.active = false;
                            positions[i3 + 1] = -1000;
                        }
                    } else if (p.active === false && positions[i * 3 + 1] > -999) {
                        positions[i * 3 + 1] = -1000;
                        hasActiveStarParticles = true;
                    }
                });
                if (hasActiveStarParticles) {
                    starEmittedParticlesRef.current.geometry.attributes.position.needsUpdate = true;
                    starEmittedParticlesRef.current.geometry.attributes.color.needsUpdate = true;
                    starEmittedParticlesRef.current.geometry.attributes.size.needsUpdate = true;
                }
            }
            // Jet particles update
            if (jetParticlesRef.current?.geometry && jetMaterialRef.current && jetParticleDataRef.current.length > 0 && THREE_ANIM) {
                const positions = jetParticlesRef.current.geometry.attributes.position.array;
                const colorsAttribute = jetParticlesRef.current.geometry.attributes.color.array;
                const sizesAttribute = jetParticlesRef.current.geometry.attributes.size.array;
                let activeJetsVisualsNeedUpdate = false;
                if (isEmittingJetsRef_anim.current) {
                    activeJetsVisualsNeedUpdate = true;
                    for (let jetDirection of [
                        1,
                        -1
                    ]){
                        for(let i = 0; i < JET_EMIT_BURST_COUNT; i++){
                            const pIndex = lastJetParticleIndexRef.current;
                            const jetP = jetParticleDataRef.current[pIndex];
                            if (jetP && !jetP.active) {
                                jetP.active = true;
                                jetP.position.set(0, jetDirection * blackHoleRadiusRef_anim.current * 1.05, 0);
                                const coneAngle = Math.random() * Math.PI * 2;
                                const elevationAngle = Math.random() * JET_SPREAD_ANGLE - JET_SPREAD_ANGLE / 2;
                                let velDir = new THREE_ANIM.Vector3(Math.sin(elevationAngle) * Math.cos(coneAngle), Math.cos(elevationAngle) * jetDirection, Math.sin(elevationAngle) * Math.sin(coneAngle));
                                const randomOffset = new THREE_ANIM.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(JET_VELOCITY_RANDOM_OFFSET_MAGNITUDE);
                                velDir.add(randomOffset).normalize();
                                jetP.velocity.copy(velDir).multiplyScalar(JET_SPEED * (0.7 + Math.random() * 0.6));
                                jetP.life = 1.0;
                                jetP.initialLife = JET_LIFESPAN * (0.6 + Math.random() * 0.8);
                                jetP.color.setHSL(Math.random() * 0.15 + 0.50, 0.95, 0.85);
                                jetP.size = JET_PARTICLE_BASE_SIZE;
                                positions[pIndex * 3] = jetP.position.x;
                                positions[pIndex * 3 + 1] = jetP.position.y;
                                positions[pIndex * 3 + 2] = jetP.position.z;
                                lastJetParticleIndexRef.current = (pIndex + 1) % JET_PARTICLE_COUNT;
                            } else if (jetP && jetP.active) {
                                break;
                            }
                        }
                    }
                }
                jetParticleDataRef.current.forEach((p, i)=>{
                    const i3 = i * 3;
                    if (p.active && p.life > 0) {
                        activeJetsVisualsNeedUpdate = true;
                        p.position.addScaledVector(p.velocity, effectiveDeltaTime);
                        p.life -= deltaTime / p.initialLife;
                        positions[i3] = p.position.x;
                        positions[i3 + 1] = p.position.y;
                        positions[i3 + 2] = p.position.z;
                        const fade = Math.max(0, p.life);
                        colorsAttribute[i3] = p.color.r * fade;
                        colorsAttribute[i3 + 1] = p.color.g * fade;
                        colorsAttribute[i3 + 2] = p.color.b * fade;
                        sizesAttribute[i] = p.size * fade;
                        if (p.life <= 0) {
                            p.active = false;
                            positions[i3 + 1] = -1000;
                        }
                    } else if (!p.active && positions[i3 + 1] > -999) {
                        positions[i3 + 1] = -1000;
                        activeJetsVisualsNeedUpdate = true;
                    }
                });
                jetParticlesRef.current.visible = true;
                if (activeJetsVisualsNeedUpdate) {
                    jetParticlesRef.current.geometry.attributes.position.needsUpdate = true;
                    jetParticlesRef.current.geometry.attributes.color.needsUpdate = true;
                    jetParticlesRef.current.geometry.attributes.size.needsUpdate = true;
                }
            }
            // Process collision events for shatter particles
            if (collisionEventsRef.current.length > 0 && shatterParticlesRef.current?.geometry && THREE_ANIM) {
                collisionEventsRef.current.forEach((event)=>{
                    const collisionTHREEPoint = new THREE_ANIM.Vector3(event.point.x, event.point.y, event.point.z);
                    const color1 = new THREE_ANIM.Color(event.color1);
                    const color2 = new THREE_ANIM.Color(event.color2);
                    for(let i = 0; i < SHATTER_PARTICLES_PER_COLLISION; i++){
                        const pIndex = lastShatterParticleIndexRef.current;
                        const particle = shatterParticleDataRef.current[pIndex];
                        if (particle && !particle.active) {
                            particle.active = true;
                            particle.position.copy(collisionTHREEPoint);
                            particle.velocity.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(SHATTER_PARTICLE_SPEED_MIN + Math.random() * (SHATTER_PARTICLE_SPEED_MAX - SHATTER_PARTICLE_SPEED_MIN));
                            particle.initialLife = SHATTER_PARTICLE_LIFESPAN_MIN + Math.random() * (SHATTER_PARTICLE_LIFESPAN_MAX - SHATTER_PARTICLE_LIFESPAN_MIN);
                            particle.life = 1.0;
                            particle.color.copy(Math.random() > 0.5 ? color1 : color2);
                            particle.size = SHATTER_PARTICLE_SIZE_MIN + Math.random() * (SHATTER_PARTICLE_SIZE_MAX - SHATTER_PARTICLE_SIZE_MIN);
                        }
                        lastShatterParticleIndexRef.current = (pIndex + 1) % SHATTER_PARTICLE_POOL_SIZE;
                    }
                    if (onCollisionEventProcessedRef.current) {
                        onCollisionEventProcessedRef.current(event.id);
                    }
                });
            }
            // Update shatter particles
            if (shatterParticlesRef.current?.geometry && shatterParticleDataRef.current.length > 0 && THREE_ANIM && tempVectorRef.current) {
                const positions = shatterParticlesRef.current.geometry.attributes.position.array;
                const colors = shatterParticlesRef.current.geometry.attributes.color.array;
                const sizes = shatterParticlesRef.current.geometry.attributes.size.array;
                let hasActiveShatterParticles = false;
                const blackHoleActualRadius = blackHoleRadiusRef_anim.current;
                shatterParticleDataRef.current.forEach((p, i)=>{
                    const i3 = i * 3;
                    if (p.active && p.life > 0) {
                        hasActiveShatterParticles = true;
                        const distanceToBHSq = p.position.lengthSq();
                        let effectiveGravityFactor = SHATTER_PARTICLE_GRAVITY_FACTOR_BASE;
                        const nearBHThresholdRadius = blackHoleActualRadius * SHATTER_PARTICLE_NEAR_BH_THRESHOLD_FACTOR;
                        const isNearBH = distanceToBHSq < nearBHThresholdRadius * nearBHThresholdRadius;
                        const quickAbsorptionRadius = blackHoleActualRadius * SHATTER_PARTICLE_QUICK_ABSORPTION_RADIUS_FACTOR;
                        const isVeryCloseToBH = distanceToBHSq < quickAbsorptionRadius * quickAbsorptionRadius;
                        if (isNearBH) {
                            effectiveGravityFactor *= SHATTER_PARTICLE_GRAVITY_BOOST_NEAR_BH;
                            if (SHATTER_PARTICLE_SPIRAL_STRENGTH_NEAR_BH > 0 && tempVectorRef.current) {
                                const tangentDirection = tempVectorRef.current.set(-p.position.z, 0, p.position.x).normalize();
                                const closenessFactor = Math.max(0, 1.0 - Math.sqrt(distanceToBHSq) / nearBHThresholdRadius);
                                const spiralMagnitude = SHATTER_PARTICLE_SPIRAL_STRENGTH_NEAR_BH * closenessFactor * effectiveGravityFactor * effectiveDeltaTime * 0.1;
                                p.velocity.addScaledVector(tangentDirection, spiralMagnitude);
                            }
                        }
                        if (tempVectorRef.current) {
                            const forceDirection = tempVectorRef.current.copy(p.position).negate();
                            const invDistanceSq = 1.0 / Math.max(0.01, distanceToBHSq);
                            forceDirection.normalize().multiplyScalar(effectiveGravityFactor * blackHoleActualRadius * invDistanceSq);
                            p.velocity.addScaledVector(forceDirection, effectiveDeltaTime);
                        }
                        p.position.addScaledVector(p.velocity, effectiveDeltaTime);
                        let lifeReductionFactor = 1.0;
                        if (isVeryCloseToBH) {
                            lifeReductionFactor = SHATTER_PARTICLE_LIFESPAN_REDUCTION_NEAR_ABSORPTION;
                        }
                        p.life -= deltaTime / p.initialLife * lifeReductionFactor;
                        positions[i3] = p.position.x;
                        positions[i3 + 1] = p.position.y;
                        positions[i3 + 2] = p.position.z;
                        const fade = Math.max(0, p.life);
                        colors[i3] = p.color.r * fade;
                        colors[i3 + 1] = p.color.g * fade;
                        colors[i3 + 2] = p.color.b * fade;
                        sizes[i] = p.size * fade;
                        if (p.life <= 0 || distanceToBHSq < blackHoleActualRadius * blackHoleActualRadius * 0.9) {
                            p.active = false;
                            positions[i3 + 1] = -1000;
                        }
                    } else if (!p.active && positions[i3 + 1] > -999) {
                        positions[i3 + 1] = -1000;
                        hasActiveShatterParticles = true;
                    }
                });
                if (hasActiveShatterParticles) {
                    shatterParticlesRef.current.geometry.attributes.position.needsUpdate = true;
                    shatterParticlesRef.current.geometry.attributes.color.needsUpdate = true;
                    shatterParticlesRef.current.geometry.attributes.size.needsUpdate = true;
                }
            }
            // Render using EffectComposer with lensing post-processing
            if (composerRef.current && renderer_anim && blackHoleRef.current && foregroundSceneRef.current) {
                // Hide black hole so it doesn't get lensed
                blackHoleRef.current.visible = false;
                // Render everything through composer (gets lensed)
                composerRef.current.render();
                // Render black hole on top (not lensed, just masks the center)
                blackHoleRef.current.visible = true;
                renderer_anim.clearDepth();
                renderer_anim.render(foregroundSceneRef.current, mainCam_anim);
            }
        };
        animate();
        const handleResize = ()=>{
            if (mountRef.current && cameraRef.current && rendererRef.current && composerRef.current && lensingPassRef.current) {
                const width = mountRef.current.clientWidth;
                const height = mountRef.current.clientHeight;
                cameraRef.current.aspect = width / height;
                cameraRef.current.updateProjectionMatrix();
                rendererRef.current.setSize(width, height);
                composerRef.current.setSize(width, height);
                lensingPassRef.current.uniforms.resolution.value.set(width * window.devicePixelRatio, height * window.devicePixelRatio);
            }
        };
        window.addEventListener('resize', handleResize);
        return ()=>{
            window.removeEventListener('resize', handleResize);
            if (currentRendererDomElement) {
                currentRendererDomElement.removeEventListener('pointerdown', handleCanvasShiftClick);
            }
            if (controlsRef.current) {
                controlsRef.current.dispose();
            }
            if (composerRef.current) {
                composerRef.current.dispose();
            }
            cancelAnimationFrame(animationFrameId);
            const THREE_CLEANUP = THREEInstanceRef.current;
            if (THREE_CLEANUP) {
                celestialObjectsRef.current.forEach((object)=>{
                    foregroundSceneRef.current?.remove(object);
                    if (object instanceof THREE_CLEANUP.Group) {
                        object.traverse((child)=>{
                            if (child instanceof THREE_CLEANUP.Mesh) {
                                child.geometry?.dispose();
                                if (Array.isArray(child.material)) {
                                    child.material.forEach((m)=>m.dispose());
                                } else {
                                    child.material?.dispose();
                                }
                            }
                        });
                    } else if (object instanceof THREE_CLEANUP.Mesh) {
                        object.geometry?.dispose();
                        if (object.material) {
                            object.material.dispose();
                        }
                    }
                });
            }
            celestialObjectsRef.current.clear();
            dissolvingObjectsProgressRef.current.clear();
            evolvingObjectDataRef.current.clear();
            starTwinkleDataRef.current = [];
            const disposeParticleSystem = (systemRef)=>{
                const THREE_CLEANUP_PARTICLES = THREEInstanceRef.current;
                if (systemRef.current) {
                    systemRef.current.geometry.dispose();
                    if (THREE_CLEANUP_PARTICLES && systemRef.current.material instanceof THREE_CLEANUP_PARTICLES.Material) {
                        systemRef.current.material.dispose();
                    }
                    foregroundSceneRef.current?.remove(systemRef.current);
                    systemRef.current = null;
                }
            };
            disposeParticleSystem(jetParticlesRef);
            disposeParticleSystem(starEmittedParticlesRef);
            disposeParticleSystem(shatterParticlesRef);
            sceneCaptureRenderTargetRef.current?.dispose();
            foregroundSceneRef.current?.traverse((object)=>{
                const THREE_CLEANUP = THREEInstanceRef.current;
                if (!THREE_CLEANUP) return;
                if (object instanceof THREE_CLEANUP.Mesh || object instanceof THREE_CLEANUP.Points || object instanceof THREE_CLEANUP.LineSegments) {
                    if (object.geometry) object.geometry.dispose();
                    const material = object.material;
                    if (material) {
                        if (Array.isArray(material)) {
                            material.forEach((mat)=>mat.dispose());
                        } else {
                            material.dispose();
                        }
                    }
                }
            });
            backgroundSceneRef.current?.traverse((object)=>{
                const THREE_CLEANUP_BG = THREEInstanceRef.current;
                if (!THREE_CLEANUP_BG) return;
                if (object instanceof THREE_CLEANUP_BG.Points) {
                    if (object.geometry) object.geometry.dispose();
                    if (object.material) object.material.dispose();
                }
            });
            if (mountRef.current && rendererRef.current) {
                mountRef.current.removeChild(rendererRef.current.domElement);
            }
            rendererRef.current?.dispose();
            diskParticleDataRef.current = [];
            THREEInstanceRef.current = null;
        };
    }, []);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (blackHoleRef.current) {
            // Scale the visual representation of the black hole
            blackHoleRef.current.scale.set(blackHoleRadiusRef_anim.current, blackHoleRadiusRef_anim.current, blackHoleRadiusRef_anim.current);
        }
        if (controlsRef.current) {
            controlsRef.current.minDistance = blackHoleRadiusRef_anim.current * 1.2;
        }
        if (cameraRef.current && cameraRef.current.position.length() < blackHoleRadiusRef_anim.current * 1.2) {
            const newPos = cameraRef.current.position.clone().normalize().multiplyScalar(blackHoleRadiusRef_anim.current * 1.2);
            cameraRef.current.position.copy(newPos);
            if (onCameraUpdateRef.current) {
                onCameraUpdateRef.current({
                    x: newPos.x,
                    y: newPos.y,
                    z: newPos.z
                });
            }
        }
    }, [
        blackHoleRadius
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (foregroundSceneRef.current && THREEInstanceRef.current) {
            createAndAddAccretionParticles(accretionDiskInnerRadius, accretionDiskOuterRadius, accretionDiskOpacity);
        }
    }, [
        accretionDiskInnerRadius,
        accretionDiskOuterRadius,
        accretionDiskOpacity,
        createAndAddAccretionParticles
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        const scene = foregroundSceneRef.current;
        const THREE_OBJECTS = THREEInstanceRef.current; // Renamed from THREE_PLANETS
        if (!scene || !THREE_OBJECTS) return;
        const currentObjectIds = new Set(Array.from(celestialObjectsRef.current.keys()));
        const incomingObjectIds = new Set(spawnedPlanets.map((p)=>p.id)); // spawnedPlanets are the props
        spawnedPlanets.forEach((objProp)=>{
            let object3D = celestialObjectsRef.current.get(objProp.id);
            const currentStarMassFactor = (objProp.type === 'star' ? objProp.currentMassFactor : 1.0) ?? 1.0;
            if (!object3D) {
                const sphereGeometry = new THREE_OBJECTS.SphereGeometry(1, 16, 16); // Unit sphere
                let sphereMaterial;
                if (objProp.type === 'star') {
                    const starGroup = new THREE_OBJECTS.Group();
                    sphereMaterial = new THREE_OBJECTS.MeshBasicMaterial({
                        color: objProp.color
                    });
                    const starSphere = new THREE_OBJECTS.Mesh(sphereGeometry, sphereMaterial);
                    starGroup.add(starSphere);
                    object3D = starGroup;
                } else {
                    sphereMaterial = new THREE_OBJECTS.MeshStandardMaterial({
                        color: objProp.color,
                        roughness: 0.5,
                        metalness: 0.1
                    });
                    object3D = new THREE_OBJECTS.Mesh(sphereGeometry, sphereMaterial);
                }
                // Set initial position and scale from objProp
                object3D.position.set(objProp.position.x, objProp.position.y, objProp.position.z);
                object3D.scale.set(objProp.initialScale.x * currentStarMassFactor, objProp.initialScale.y * currentStarMassFactor, objProp.initialScale.z * currentStarMassFactor);
                scene.add(object3D);
                celestialObjectsRef.current.set(objProp.id, object3D);
                object3D.userData = {
                    objectId: objProp.id
                };
                evolvingObjectDataRef.current.set(objProp.id, {
                    id: objProp.id,
                    position: new THREE_OBJECTS.Vector3(objProp.position.x, objProp.position.y, objProp.position.z),
                    velocity: new THREE_OBJECTS.Vector3(objProp.velocity.x, objProp.velocity.y, objProp.velocity.z),
                    ttl: objProp.timeToLive
                });
            } else {
                const evolvingData = evolvingObjectDataRef.current.get(objProp.id);
                if (evolvingData) {
                    // Update color if changed (though color typically doesn't change post-spawn)
                    if (objProp.type === 'star' && object3D instanceof THREE_OBJECTS.Group) {
                        const starSphere = object3D.children.find((child)=>child instanceof THREE_OBJECTS.Mesh);
                        if (starSphere && starSphere.material instanceof THREE_OBJECTS.MeshBasicMaterial) {
                            if (starSphere.material.color.getHexString() !== new THREE_OBJECTS.Color(objProp.color).getHexString()) {
                                starSphere.material.color.set(objProp.color);
                            }
                        }
                    } else if (objProp.type === 'planet' && object3D instanceof THREE_OBJECTS.Mesh) {
                        if (object3D.material instanceof THREE_OBJECTS.MeshStandardMaterial) {
                            if (object3D.material.color.getHexString() !== new THREE_OBJECTS.Color(objProp.color).getHexString()) {
                                object3D.material.color.set(objProp.color);
                            }
                        }
                    }
                    // Update TTL if it changed in props (e.g. due to dissolution trigger)
                    if (objProp.isDissolving && evolvingData.ttl > objProp.timeToLive) {
                        evolvingData.ttl = objProp.timeToLive;
                    } else if (!objProp.isDissolving && evolvingData.ttl !== objProp.timeToLive) {
                        evolvingData.ttl = objProp.timeToLive;
                    }
                    // Position and velocity are driven by physics loop, but ensure scale reflects mass changes for stars
                    object3D.scale.set(objProp.initialScale.x * currentStarMassFactor * (objProp.isDissolving ? 1 - (dissolvingObjectsProgressRef.current.get(objProp.id) || 0) : 1), objProp.initialScale.y * currentStarMassFactor * (objProp.isDissolving ? 1 - (dissolvingObjectsProgressRef.current.get(objProp.id) || 0) : 1), objProp.initialScale.z * currentStarMassFactor * (objProp.isDissolving ? 1 - (dissolvingObjectsProgressRef.current.get(objProp.id) || 0) : 1));
                }
            }
        });
        // Remove objects from scene if they are no longer in spawnedPlanets prop
        currentObjectIds.forEach((id)=>{
            if (!incomingObjectIds.has(id)) {
                const object3D = celestialObjectsRef.current.get(id);
                if (object3D) {
                    scene.remove(object3D);
                    if (object3D instanceof THREE_OBJECTS.Group) {
                        object3D.traverse((child)=>{
                            if (child instanceof THREE_OBJECTS.Mesh) {
                                child.geometry?.dispose();
                                if (Array.isArray(child.material)) {
                                    child.material.forEach((m)=>m.dispose());
                                } else {
                                    child.material?.dispose();
                                }
                            }
                        });
                    } else if (object3D instanceof THREE_OBJECTS.Mesh) {
                        object3D.geometry?.dispose();
                        if (object3D.material) {
                            object3D.material.dispose();
                        }
                    }
                    celestialObjectsRef.current.delete(id);
                }
                evolvingObjectDataRef.current.delete(id);
                dissolvingObjectsProgressRef.current.delete(id);
            }
        });
    }, [
        spawnedPlanets
    ]); // Re-run when the spawnedPlanets prop array changes
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        ref: mountRef,
        className: "w-full h-full outline-none",
        "data-ai-hint": "galaxy space"
    }, void 0, false, {
        fileName: "[project]/src/components/event-horizon/three-blackhole-canvas.tsx",
        lineNumber: 1486,
        columnNumber: 10
    }, this);
};
const __TURBOPACK__default__export__ = ThreeBlackholeCanvas;
}}),

};

//# sourceMappingURL=src_components_event-horizon_three-blackhole-canvas_tsx_48b41e58._.js.map