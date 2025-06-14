
import type * as THREE from 'three';

export const lensingShader = {
  uniforms: {
    uTexture: { value: null as THREE.Texture | null },
    uBlackHolePos: { value: new (require('three') as typeof THREE).Vector2(0.5, 0.5) },
    uStrength: { value: 0.03 }, // Adjusted strength for a more subtle effect initially
    uAspectRatio: { value: 1.0 }, // To correct for screen aspect ratio
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
    varying vec2 vUv;

    void main() {
      vec2 centeredUv = vUv - uBlackHolePos;
      // Correct for aspect ratio to make the lensing effect circular
      centeredUv.x *= uAspectRatio;

      float dist = length(centeredUv);
      
      // Prevent division by zero or extreme distortion at the very center
      float lensFactor = smoothstep(0.0, 0.5, dist); // Gradually increase effect from center
      float lensedDist = dist + uStrength / (dist + 0.01) * lensFactor;

      vec2 dir = normalize(centeredUv);
      vec2 distortedUv = uBlackHolePos + dir * lensedDist / vec2(uAspectRatio, 1.0);

      // Clamp distortedUv to avoid texture wrapping issues if distortion is too strong
      distortedUv = clamp(distortedUv, vec2(0.0), vec2(1.0));
      
      gl_FragColor = texture2D(uTexture, distortedUv);
    }
  `
};
