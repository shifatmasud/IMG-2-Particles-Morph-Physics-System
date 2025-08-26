import React, { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';

type MorphDirection = 'toTarget' | 'toSource' | null;

interface ImageParticleEffectProps {
  sourceImageUrl: string;
  targetImageUrl: string | null;
  morphDirection: MorphDirection;
  onMorphComplete: (direction: 'toTarget' | 'toSource') => void;
}

interface Particle {
    currentPosition: THREE.Vector3;
    sourcePosition: THREE.Vector3;
    targetPosition: THREE.Vector3;
    velocity: THREE.Vector3;
    currentColor: THREE.Color;
    sourceColor: THREE.Color;
    targetColor: THREE.Color;
    attractorPosition: THREE.Vector3;
    burstPosition: THREE.Vector3;
    sphereTargetPosition: THREE.Vector3;
    mouseBurstPosition: THREE.Vector3;
}

const easeInOutCubic = (t: number): number => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const ImageParticleEffect: React.FC<ImageParticleEffectProps> = ({ sourceImageUrl, targetImageUrl, morphDirection, onMorphComplete }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const targetParticleDataRef = useRef<{ position: THREE.Vector3; color: THREE.Color; }[] | null>(null);
  const instancedMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const onMorphCompleteRef = useRef(onMorphComplete);
  const mouseInteractionStateRef = useRef<'none' | 'bursting' | 'attracting'>('none');
  const mouseInteractionStartTimeRef = useRef<number>(0);


  useEffect(() => {
    onMorphCompleteRef.current = onMorphComplete;
  }, [onMorphComplete]);


  const morphStateRef = useRef({
    isMorphing: false,
    startTime: 0,
    direction: null as MorphDirection,
    duration: 4000,
    phaseOneDuration: 1300,
    phaseTwoDuration: 1300,
  });

  const getImageParticleData = useCallback((image: HTMLImageElement, onComplete: (data: { position: THREE.Vector3, color: THREE.Color }[]) => void) => {
    const data: { position: THREE.Vector3, color: THREE.Color }[] = [];
    const MAX_WIDTH = 400;
    const MAX_HEIGHT = 400;
    let imgWidth = image.width;
    let imgHeight = image.height;

    const ratio = Math.min(MAX_WIDTH / imgWidth, MAX_HEIGHT / imgHeight);
    imgWidth = Math.floor(imgWidth * ratio);
    imgHeight = Math.floor(imgHeight * ratio);
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.width = imgWidth;
    canvas.height = imgHeight;
    context.drawImage(image, 0, 0, imgWidth, imgHeight);
    
    const imageData = context.getImageData(0, 0, imgWidth, imgHeight).data;
    const density = 2;

    for (let y = 0; y < imgHeight; y += density) {
        for (let x = 0; x < imgWidth; x += density) {
            const index = (y * imgWidth + x) * 4;
            const alpha = imageData[index + 3];

            if (alpha > 128) {
                const posX = x - imgWidth / 2;
                const posY = -y + imgHeight / 2;
                const color = new THREE.Color();
                color.setRGB(
                    imageData[index] / 255, 
                    imageData[index + 1] / 255, 
                    imageData[index + 2] / 255
                );
                color.convertSRGBToLinear(); // Handle color space correctly
                data.push({
                    position: new THREE.Vector3(posX, posY, 0),
                    color: color,
                });
            }
        }
    }
    onComplete(data);
  }, []);

  // Main setup effect
  useEffect(() => {
    if (!mountRef.current) return;
    const currentMount = mountRef.current;

    // Scene setup
    sceneRef.current = new THREE.Scene();
    cameraRef.current = new THREE.PerspectiveCamera(75, currentMount.clientWidth / currentMount.clientHeight, 0.1, 1000);
    cameraRef.current.position.z = 300;
    rendererRef.current = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    rendererRef.current.setClearColor(0x000000, 0);
    rendererRef.current.setSize(currentMount.clientWidth, currentMount.clientHeight);
    rendererRef.current.setPixelRatio(window.devicePixelRatio);
    rendererRef.current.outputColorSpace = THREE.SRGBColorSpace;
    currentMount.appendChild(rendererRef.current.domElement);

    const dummy = new THREE.Object3D();

    const loader = new THREE.ImageLoader();
    loader.setCrossOrigin('Anonymous');
    loader.load(sourceImageUrl, (image) => {
        getImageParticleData(image, (sourceData) => {
            if (sourceData.length === 0) return;

            particlesRef.current = sourceData.map(data => ({
                currentPosition: data.position.clone(),
                sourcePosition: data.position.clone(),
                targetPosition: data.position.clone(), // Initially same as source
                velocity: new THREE.Vector3(0, 0, 0),
                currentColor: data.color.clone(),
                sourceColor: data.color.clone(),
                targetColor: data.color.clone(), // Initially same as source
                attractorPosition: data.position.clone(),
                burstPosition: new THREE.Vector3(),
                sphereTargetPosition: new THREE.Vector3(),
                mouseBurstPosition: new THREE.Vector3(),
            }));

            const particleCount = particlesRef.current.length;
            const particleGeometry = new THREE.CircleGeometry(1.25, 6);
            const particleMaterial = new THREE.MeshBasicMaterial();
            instancedMeshRef.current = new THREE.InstancedMesh(particleGeometry, particleMaterial, particleCount);
            instancedMeshRef.current.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

            for (let i = 0; i < particleCount; i++) {
                const p = particlesRef.current[i];
                dummy.position.copy(p.currentPosition);
                dummy.updateMatrix();
                instancedMeshRef.current.setMatrixAt(i, dummy.matrix);
                instancedMeshRef.current.setColorAt(i, p.currentColor);
            }
            sceneRef.current?.add(instancedMeshRef.current);
        });
    });

    // Mouse interaction
    const mouse = new THREE.Vector2(-1000, -1000);
    const handleMouseMove = (event: MouseEvent) => {
        const rect = rendererRef.current!.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };
    const handleMouseDown = () => {
        mouseInteractionStateRef.current = 'bursting';
        mouseInteractionStartTimeRef.current = performance.now();
        const burstRadius = 150;
        const sphereRadius = 120;
    
        particlesRef.current.forEach(p => {
            // Target for the initial burst phase, relative to current position
            p.mouseBurstPosition.copy(p.currentPosition).add(
                new THREE.Vector3(
                    (Math.random() - 0.5) * burstRadius,
                    (Math.random() - 0.5) * burstRadius,
                    (Math.random() - 0.5) * burstRadius
                )
            );
    
            // Target for the final sphere attraction phase, relative to cursor
            const r = sphereRadius * Math.cbrt(Math.random());
            const theta = Math.random() * 2 * Math.PI;
            const phi = Math.acos(2 * Math.random() - 1);
            p.sphereTargetPosition.setFromSphericalCoords(r, phi, theta);
        });
    };
    const handleMouseUp = () => {
        // By only changing the state, we allow the particles to retain their velocity.
        // The existing physics in the animation loop will then smoothly guide them
        // back to their attractor positions, creating an inertial effect.
        mouseInteractionStateRef.current = 'none';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);


    // Animation loop
    const mouse3D = new THREE.Vector3();
    const animate = () => {
        animationFrameIdRef.current = requestAnimationFrame(animate);
        if (!cameraRef.current || !sceneRef.current || !rendererRef.current || !instancedMeshRef.current || particlesRef.current.length === 0) return;

        mouse3D.set(mouse.x, mouse.y, 0.5);
        mouse3D.unproject(cameraRef.current);
        const dir = mouse3D.sub(cameraRef.current.position).normalize();
        const distance = -cameraRef.current.position.z / dir.z;
        const pos = cameraRef.current.position.clone().add(dir.multiplyScalar(distance));

        let needsColorUpdate = false;
        
        const mouseState = mouseInteractionStateRef.current;
        const mouseInteractionBurstDuration = 400; // ms

        if (mouseState !== 'none') {
            const interactionElapsedTime = performance.now() - mouseInteractionStartTimeRef.current;

            particlesRef.current.forEach((p, i) => {
                let targetPosition: THREE.Vector3 | null = null;
                let lerpFactor = 0.04;

                if (mouseState === 'bursting') {
                    if (interactionElapsedTime > mouseInteractionBurstDuration) {
                        // Transition state after duration. Logic will apply on the next frame.
                        mouseInteractionStateRef.current = 'attracting';
                    }
                    targetPosition = p.mouseBurstPosition;
                    lerpFactor = 0.08; // A faster burst
                } else if (mouseState === 'attracting') {
                    targetPosition = pos.clone().add(p.sphereTargetPosition);
                    lerpFactor = 0.04; // Gentle attraction
                }

                if (targetPosition) {
                    const oldPosition = p.currentPosition.clone();
                    p.currentPosition.lerp(targetPosition, lerpFactor);
                    p.velocity.subVectors(p.currentPosition, oldPosition);

                    dummy.position.copy(p.currentPosition);
                    dummy.updateMatrix();
                    instancedMeshRef.current!.setMatrixAt(i, dummy.matrix);
                }
            });

            instancedMeshRef.current!.instanceMatrix.needsUpdate = true;
            rendererRef.current.render(sceneRef.current, cameraRef.current);
            return; // Skip other physics during mouse interaction
        }


        const morphState = morphStateRef.current;
        if (morphState.isMorphing) {
            const elapsedTime = performance.now() - morphState.startTime;
            const { duration, phaseOneDuration, phaseTwoDuration, direction } = morphState;
            const phaseTwoEndTime = phaseOneDuration + phaseTwoDuration;

            if (elapsedTime >= duration) { // Morph ended
                particlesRef.current.forEach(p => {
                    p.attractorPosition.copy(direction === 'toTarget' ? p.targetPosition : p.sourcePosition);
                    p.currentColor.copy(direction === 'toTarget' ? p.targetColor : p.sourceColor);
                });
                morphState.isMorphing = false;
                onMorphCompleteRef.current(direction!);
                needsColorUpdate = true;
            } else { // Morph in progress
                const sphereRadius = 180;
                const totalProgress = easeInOutCubic(elapsedTime / duration);

                particlesRef.current.forEach((p, i) => {
                    const startColor = direction === 'toTarget' ? p.sourceColor : p.targetColor;
                    const endColor = direction === 'toTarget' ? p.targetColor : p.sourceColor;
                    p.currentColor.copy(startColor).lerp(endColor, totalProgress);
                    needsColorUpdate = true;

                    const currentStartPos = direction === 'toTarget' ? p.sourcePosition : p.targetPosition;
                    const currentEndPos = direction === 'toTarget' ? p.targetPosition : p.sourcePosition;
                    const phi = Math.acos(-1 + (2 * i) / particlesRef.current.length);
                    const theta = Math.sqrt(particlesRef.current.length * Math.PI) * phi;
                    
                    const spherePos = new THREE.Vector3().setFromSphericalCoords(sphereRadius, phi, theta);
                   
                    if (elapsedTime < phaseOneDuration) {
                        const progress = easeInOutCubic(elapsedTime / phaseOneDuration);
                        p.attractorPosition.lerpVectors(currentStartPos, p.burstPosition, progress);
                    } else if (elapsedTime < phaseTwoEndTime) {
                        const progress = easeInOutCubic((elapsedTime - phaseOneDuration) / phaseTwoDuration);
                        p.attractorPosition.lerpVectors(p.burstPosition, spherePos, progress);
                    } else {
                        const phaseThreeDuration = duration - phaseTwoEndTime;
                        const progress = easeInOutCubic((elapsedTime - phaseTwoEndTime) / phaseThreeDuration);
                        
                        // Swirling motion to avoid straight lines
                        const intermediatePos = new THREE.Vector3().lerpVectors(spherePos, currentEndPos, progress);
                        const travelVector = new THREE.Vector3().subVectors(currentEndPos, spherePos);
                        const swirlAxis = new THREE.Vector3(0.3, -0.4, 0.8).normalize();
                        const perpendicular = new THREE.Vector3().crossVectors(travelVector, swirlAxis).normalize();
                        
                        if (perpendicular.lengthSq() < 0.1) { // Fallback if parallel
                            perpendicular.set(0, 1, 0);
                        }
                        
                        const swirlAmplitude = travelVector.length() * 0.3 * Math.sin(progress * Math.PI);
                        const swirlOffset = perpendicular.multiplyScalar(swirlAmplitude);

                        p.attractorPosition.copy(intermediatePos).add(swirlOffset);
                    }
                });
            }
        }
        
        const returnStrength = 0.02, damping = 0.92;
        const pushRadius = 60;
        const pushStrength = 0.8;

        for (let i = 0; i < particlesRef.current.length; i++) {
            const p = particlesRef.current[i];

            // Mouse push force (only when not attracting)
            if (mouseInteractionStateRef.current === 'none') {
                const distanceToMouse = p.currentPosition.distanceTo(pos);
                if (distanceToMouse < pushRadius) {
                    const pushForce = new THREE.Vector3()
                        .subVectors(p.currentPosition, pos)
                        .normalize()
                        .multiplyScalar((pushRadius - distanceToMouse) / pushRadius)
                        .multiplyScalar(pushStrength);
                    p.velocity.add(pushForce);
                }
            }
            
            // Return to attractor force
            const returnForce = new THREE.Vector3().subVectors(p.attractorPosition, p.currentPosition).multiplyScalar(returnStrength);
            p.velocity.add(returnForce);
            p.velocity.multiplyScalar(damping);
            p.currentPosition.add(p.velocity);
            
            if (needsColorUpdate) instancedMeshRef.current.setColorAt(i, p.currentColor);
            dummy.position.copy(p.currentPosition);
            dummy.updateMatrix();
            instancedMeshRef.current.setMatrixAt(i, dummy.matrix);
        }

        instancedMeshRef.current.instanceMatrix.needsUpdate = true;
        if (needsColorUpdate) {
            instancedMeshRef.current.instanceColor!.needsUpdate = true;
        }

        rendererRef.current.render(sceneRef.current, cameraRef.current);
    };

    animate();

    const handleResize = () => {
        if (!rendererRef.current || !cameraRef.current) return;
        const width = currentMount.clientWidth;
        const height = currentMount.clientHeight;
        rendererRef.current.setSize(width, height);
        cameraRef.current.aspect = width / height;
        cameraRef.current.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    
    // Cleanup
    return () => {
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mousedown', handleMouseDown);
        window.removeEventListener('mouseup', handleMouseUp);
        if (animationFrameIdRef.current) {
            cancelAnimationFrame(animationFrameIdRef.current);
        }
        if (rendererRef.current) {
            currentMount.removeChild(rendererRef.current.domElement);
        }
    };
  }, [sourceImageUrl, getImageParticleData]);

  // Handle target image loading
  useEffect(() => {
    if (targetImageUrl) {
      const loader = new THREE.ImageLoader();
      loader.setCrossOrigin('Anonymous');
      loader.load(targetImageUrl, (image) => {
        getImageParticleData(image, (targetData) => {
          targetParticleDataRef.current = targetData;
        });
      });
    }
  }, [targetImageUrl, getImageParticleData]);

  // Handle morphing trigger
  useEffect(() => {
    if (morphDirection && targetParticleDataRef.current) {
        const sourceParticles = particlesRef.current;
        const targetParticles = targetParticleDataRef.current;
        const numParticles = Math.min(sourceParticles.length, targetParticles.length);
        
        for (let i = 0; i < numParticles; i++) {
            sourceParticles[i].targetPosition.copy(targetParticles[i].position);
            sourceParticles[i].targetColor.copy(targetParticles[i].color);
        }

        if (sourceParticles.length > numParticles) {
            for (let i = numParticles; i < sourceParticles.length; i++) {
                const targetIndex = i % numParticles;
                sourceParticles[i].targetPosition.copy(targetParticles[targetIndex].position);
                sourceParticles[i].targetColor.copy(targetParticles[targetIndex].color);
            }
        }
        
        particlesRef.current.forEach(p => {
             const burstRadius = 300;
             p.burstPosition.copy(p.sourcePosition).add(new THREE.Vector3(
                (Math.random() - 0.5) * burstRadius,
                (Math.random() - 0.5) * burstRadius,
                (Math.random() - 0.5) * burstRadius
             ));
        });

        morphStateRef.current.isMorphing = true;
        morphStateRef.current.startTime = performance.now();
        morphStateRef.current.direction = morphDirection;
    }
  }, [morphDirection]);

  return <div ref={mountRef} style={{ width: '100vw', height: '100vh', position: 'absolute', top: 0, left: 0 }} />;
};

export default ImageParticleEffect;
