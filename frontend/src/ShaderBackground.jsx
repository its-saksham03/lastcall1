import React, { useEffect, useRef } from 'react';

export default function ShaderBackground({ type = 'bg', className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Sync WebGL size with CSS layout size
    function syncSize() {
      const w = canvas.clientWidth || 1280;
      const h = canvas.clientHeight || 720;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }

    let resizeObserver;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(syncSize);
      resizeObserver.observe(canvas);
    }
    syncSize();

    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return;

    const vs = `
      attribute vec2 a_position;
      varying vec2 v_texCoord;
      void main() {
        v_texCoord = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    // Shader Source selection
    const fsOrb = `
      precision highp float;
      uniform float u_time;
      uniform vec2 u_resolution;
      uniform vec2 u_mouse;
      varying vec2 v_texCoord;

      void main() {
          vec2 uv = v_texCoord;
          vec2 center = vec2(0.5, 0.5);
          
          float dist = distance(uv, center);
          float pulse = 0.5 + 0.5 * sin(u_time * 0.8);
          float radius = 0.25 + 0.02 * pulse;
          
          vec3 color1 = vec3(0.54, 0.36, 0.96); // Purple
          vec3 color2 = vec3(0.23, 0.51, 0.96); // Blue
          vec3 color3 = vec3(0.06, 0.72, 0.51); // Emerald
          
          float angle = atan(uv.y - center.y, uv.x - center.x);
          float swirl = sin(angle * 3.0 + u_time * 1.2);
          
          vec3 finalColor = mix(color1, color2, 0.5 + 0.5 * swirl);
          finalColor = mix(finalColor, color3, 0.2 * sin(u_time * 0.5));
          
          float glow = exp(-dist * 4.5);
          float core = smoothstep(radius, radius - 0.1, dist);
          
          float n = fract(sin(dot(uv + u_time * 0.01, vec2(12.9898, 78.233))) * 43758.5453);
          float particles = smoothstep(0.98, 1.0, n) * glow;
          
          gl_FragColor = vec4(finalColor * (core + glow * 0.6) + particles, (core + glow * 0.4));
      }
    `;

    const fsBg = `
      precision highp float;
      uniform float u_time;
      uniform vec2 u_resolution;
      varying vec2 v_texCoord;

      float noise(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
          vec2 uv = v_texCoord;
          
          vec3 color1 = vec3(0.06, 0.07, 0.08); // Deep Graphite
          vec3 color2 = vec3(0.08, 0.09, 0.11); // Slightly lighter
          vec3 accent = vec3(0.23, 0.51, 0.96); // Blue glow
          
          float n1 = noise(uv * 2.0 + u_time * 0.05);
          float n2 = noise(uv * 3.0 - u_time * 0.03);
          
          vec3 bg = mix(color1, color2, n1 * 0.5 + n2 * 0.5);
          
          vec2 lightPos = vec2(0.5 + 0.3 * cos(u_time * 0.2), 0.5 + 0.3 * sin(u_time * 0.3));
          float light = smoothstep(0.8, 0.0, distance(uv, lightPos));
          bg += accent * light * 0.05;
          
          float p = noise(uv * 50.0 + vec2(u_time * 0.1, u_time * 0.05));
          if (p > 0.998) bg += 0.1;
          
          gl_FragColor = vec4(bg, 1.0);
      }
    `;

    const fs = type === 'orb' ? fsOrb : fsBg;

    function compileShader(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('Shader compilation error:', gl.getShaderInfoLog(s));
      }
      return s;
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    
    const pos = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uRes = gl.getUniformLocation(prog, 'u_resolution');
    const uMouse = gl.getUniformLocation(prog, 'u_mouse');

    let mouse = { x: canvas.width / 2, y: canvas.height / 2 };

    const handleMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width && rect.height) {
        const nx = (event.clientX - rect.left) / rect.width;
        const ny = 1.0 - (event.clientY - rect.top) / rect.height;
        mouse.x = nx * canvas.width;
        mouse.y = ny * canvas.height;
      }
    };

    if (type === 'orb') {
      window.addEventListener('mousemove', handleMouseMove);
    }

    let animId;
    function render(t) {
      if (typeof ResizeObserver === 'undefined') syncSize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (uTime) gl.uniform1f(uTime, t * 0.001);
      if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
      if (uMouse) gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      animId = requestAnimationFrame(render);
    }
    
    render(0);

    return () => {
      cancelAnimationFrame(animId);
      if (resizeObserver) resizeObserver.disconnect();
      if (type === 'orb') {
        window.removeEventListener('mousemove', handleMouseMove);
      }
    };
  }, [type]);

  return <canvas ref={canvasRef} className={className} style={{ display: 'block', width: '100%', height: '100%' }} />;
}
