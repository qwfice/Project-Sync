// ============================================================
// ProjectSync Landing Page — 3D hero + scroll animations
// ============================================================

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

// ===================== 3D HERO (Three.js) =====================
function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch (e) {
    return false;
  }
}

function initHeroScene() {
  const canvas = document.getElementById('hero-canvas');
  const heroSection = document.getElementById('hero');

  if (!supportsWebGL() || typeof THREE === 'undefined') {
    canvas.classList.add('hidden-fallback');
    return;
  }

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.setSize(heroSection.clientWidth, heroSection.clientHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, heroSection.clientWidth / heroSection.clientHeight, 0.1, 100);
  camera.position.set(0, 0, 9);

  scene.add(new THREE.AmbientLight(0x8fa4e0, 0.55));
  const keyLight = new THREE.DirectionalLight(0x6d93f2, 1.5);
  keyLight.position.set(4, 5, 6);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.35);
  rimLight.position.set(-6, -3, -4);
  scene.add(rimLight);

  // A small cluster of low-poly shapes representing synced tasks/nodes
  const geometries = [
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.OctahedronGeometry(0.8, 0),
    new THREE.TorusGeometry(0.7, 0.22, 8, 24),
    new THREE.TetrahedronGeometry(0.9, 0),
  ];

  const shapeCount = isMobile ? 7 : 12;
  const shapes = [];
  const group = new THREE.Group();

  for (let i = 0; i < shapeCount; i++) {
    const geo = geometries[i % geometries.length];
    const material = new THREE.MeshStandardMaterial({
      color: i % 3 === 0 ? 0x4d74dd : (i % 3 === 1 ? 0x1a1f2c : 0x8fb3ff),
      roughness: 0.35,
      metalness: 0.15,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, material);

    const radius = 3.2 + Math.random() * 2.4;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos((Math.random() * 2) - 1);
    mesh.position.set(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.sin(phi) * Math.sin(theta) * 0.6,
      radius * Math.cos(phi) * 0.6 - 2
    );
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);

    const scale = 0.35 + Math.random() * 0.55;
    mesh.scale.setScalar(scale);

    mesh.userData.spin = (Math.random() - 0.5) * 0.006;
    mesh.userData.floatSpeed = 0.4 + Math.random() * 0.6;
    mesh.userData.floatOffset = Math.random() * Math.PI * 2;
    mesh.userData.baseY = mesh.position.y;

    shapes.push(mesh);
    group.add(mesh);
  }
  scene.add(group);

  // Mouse parallax target
  const pointer = { x: 0, y: 0 };
  const targetRotation = { x: 0, y: 0 };

  window.addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  let scrollFade = 1;
  let scrollDepth = 0;
  if (window.gsap && window.ScrollTrigger) {
    gsap.to({}, {
      scrollTrigger: {
        trigger: heroSection,
        start: 'top top',
        end: 'bottom top',
        scrub: true,
        onUpdate: (self) => {
          scrollFade = 1 - self.progress;
          scrollDepth = self.progress;
        }
      }
    });
  }

  let rafId = null;
  const clock = new THREE.Clock();

  function animate() {
    rafId = requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();

    targetRotation.x += (pointer.y * 0.3 - targetRotation.x) * 0.04;
    targetRotation.y += (pointer.x * 0.4 - targetRotation.y) * 0.04;

    if (!prefersReducedMotion) {
      group.rotation.x = targetRotation.x * 0.3;
      group.rotation.y = targetRotation.y * 0.3 + elapsed * 0.03;

      shapes.forEach((mesh) => {
        mesh.rotation.x += mesh.userData.spin;
        mesh.rotation.y += mesh.userData.spin * 1.4;
        mesh.position.y = mesh.userData.baseY + Math.sin(elapsed * mesh.userData.floatSpeed + mesh.userData.floatOffset) * 0.25;
      });

      camera.position.z = 9 - scrollDepth * 1.5;
    } else {
      group.rotation.y = targetRotation.y * 0.15;
    }

    group.visible = scrollFade > 0.02;
    renderer.render(scene, camera);
  }
  animate();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    } else if (!document.hidden && rafId === null) {
      animate();
    }
  });

  window.addEventListener('resize', () => {
    const w = heroSection.clientWidth;
    const h = heroSection.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
}

// ===================== SCROLL ANIMATIONS (GSAP) =====================
function initScrollAnimations() {
  if (typeof gsap === 'undefined') return;
  gsap.registerPlugin(ScrollTrigger);

  const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const duration = prefersReducedMotion ? 0.01 : 0.9;

  // Hero entrance
  gsap.to('#hero-content .reveal', {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    duration,
    stagger: prefersReducedMotion ? 0 : 0.12,
    ease: EASE_OUT,
    delay: 0.15,
  });

  // Generic reveal-on-scroll for section headers, bento cards, pricing cards
  gsap.utils.toArray('#features .reveal, #pricing .reveal').forEach((el, i) => {
    gsap.to(el, {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      duration,
      ease: EASE_OUT,
      scrollTrigger: {
        trigger: el,
        start: 'top 88%',
        toggleActions: 'play none none reverse',
      },
      delay: prefersReducedMotion ? 0 : (i % 3) * 0.08,
    });
  });

  // Mesh orb parallax
  gsap.utils.toArray('.mesh-orb').forEach((orb, i) => {
    gsap.to(orb, {
      y: prefersReducedMotion ? 0 : (i % 2 === 0 ? 120 : -80),
      ease: 'none',
      scrollTrigger: {
        trigger: '#hero',
        start: 'top top',
        end: 'bottom top',
        scrub: true,
      },
    });
  });

  // Pinned "how it works" steps — 3D depth cascade
  const steps = gsap.utils.toArray('.how-step');
  const nums = gsap.utils.toArray('.step-num');
  const progressBar = document.getElementById('how-progress');

  if (steps.length) {
    gsap.set(steps.slice(1), { opacity: 0, y: 40, rotationX: prefersReducedMotion ? 0 : -12, scale: 0.92, filter: 'blur(8px)', transformOrigin: '50% 100%' });
    gsap.set(steps[0], { opacity: 1, y: 0, rotationX: 0, scale: 1, filter: 'blur(0px)' });

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: '#how-it-works',
        start: 'top top',
        end: 'bottom bottom',
        scrub: prefersReducedMotion ? false : 1,
        onUpdate: (self) => {
          if (progressBar) progressBar.style.width = `${self.progress * 100}%`;
          const stepIndex = Math.min(steps.length - 1, Math.floor(self.progress * steps.length));
          nums.forEach((n, i) => n.classList.toggle('active', i === stepIndex));
        }
      }
    });

    steps.forEach((step, i) => {
      if (i === 0) return;
      tl.to(steps[i - 1], {
        opacity: 0, y: -40, rotationX: prefersReducedMotion ? 0 : 12, scale: 0.92, filter: 'blur(8px)',
        duration: 0.5, ease: 'power2.inOut',
      }, `step${i}`)
        .to(step, {
          opacity: 1, y: 0, rotationX: 0, scale: 1, filter: 'blur(0px)',
          duration: 0.5, ease: 'power2.out',
        }, `step${i}`);
    });
  }
}

// ===================== MAGNETIC BUTTONS =====================
function initMagneticButtons() {
  if (prefersReducedMotion || isMobile) return;
  const buttons = document.querySelectorAll('.btn-primary, .btn-ghost');

  buttons.forEach((btn) => {
    let raf = null;
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const relX = e.clientX - rect.left - rect.width / 2;
      const relY = e.clientY - rect.top - rect.height / 2;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        btn.style.transform = `translate(${relX * 0.12}px, ${relY * 0.28}px)`;
      });
    });
    btn.addEventListener('mouseleave', () => {
      if (raf) cancelAnimationFrame(raf);
      btn.style.transform = '';
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initHeroScene();
  initScrollAnimations();
  initMagneticButtons();
});
