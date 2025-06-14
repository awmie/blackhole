
import type * as THREE from 'three';

export const lensingShader = {
  uniforms: {
    uTexture: { value: null as THREE.Texture | null },
    uBlackHolePos: { value: new (require('three') as typeof THREE).Vector2(0.5, 0.5) },
    uStrength: { value: 0.015 }, 
    uAspectRatio: { value: 1.0 }, 
    uBlackHoleScreenRadius: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D uTexture;
    uniform vec2 uBlackHolePos;
    uniform float uStrength;
    uniform float uAspectRatio;
    uniform float uBlackHoleScreenRadius;
    varying vec2 vUv;

    void main() {
      vec2 centeredUv = vUv - uBlackHolePos;
      centeredUv.x *= uAspectRatio; // Correct for aspect ratio to make the effect circular

      float distFromCenter = length(centeredUv);

      float intensity = 0.0;
      // Define the band where lensing occurs, relative to the black hole's screen radius
      float bandOuterEdge = uBlackHoleScreenRadius * 1.03; // TIGHTENED outer falloff further
      float bandInnerEdge = uBlackHoleScreenRadius * 0.99; // Start effect very close to the edge
      
      // Intensity profile: peaks at uBlackHoleScreenRadius, fades to 0 towards bandInnerEdge and bandOuterEdge
      if (distFromCenter > bandInnerEdge && distFromCenter < uBlackHoleScreenRadius) {
          intensity = smoothstep(bandInnerEdge, uBlackHoleScreenRadius, distFromCenter);
      } else if (distFromCenter >= uBlackHoleScreenRadius && distFromCenter < bandOuterEdge) {
          intensity = 1.0 - smoothstep(uBlackHoleScreenRadius, bandOuterEdge, distFromCenter);
      }
      intensity = clamp(intensity, 0.0, 1.0);

      vec2 distortedUv = vUv; // Default to no distortion

      if (intensity > 0.0) {
        // Displacement is proportional to intensity & strength, inversely to distance from center.
        float displacementMagnitude = uStrength * intensity / (distFromCenter + 0.001); // Add small epsilon to avoid div by zero
        
        // dir is direction from black hole center to current pixel (aspect-corrected)
        vec2 dir = normalize(centeredUv); 
        
        // Lensing pulls light from further out, so lensedDist is original distance + displacement
        float lensedDist = distFromCenter + displacementMagnitude;

        // Calculate new UVs in aspect-corrected space, then convert back to original UV space
        distortedUv = uBlackHolePos + dir * lensedDist / vec2(uAspectRatio, 1.0);
      }
      
      distortedUv = clamp(distortedUv, vec2(0.0), vec2(1.0));
      gl_FragColor = texture2D(uTexture, distortedUv);
    }
  `
};

