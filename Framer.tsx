import React, { useState, useEffect, useCallback, useRef } from "react"
import { addPropertyControls, ControlType } from "framer"
import * as THREE from "three"

type MorphDirection = "toTarget" | "toSource" | null
interface Vec3 {
    x: number
    y: number
    z: number
}

interface ForceProps {
    returnStrength: number
    damping: number
    pushRadius: number
    pushStrength: number
    particleSize: number
    particleDensity: number
}

interface ImageParticleEffectProps {
    sourceImageUrl: string
    targetImageUrl: string | null
    morphState: "source" | "target"
    morphDirection: MorphDirection
    onMorphComplete: (direction: "toTarget" | "toSource") => void
    cameraPosition: Vec3
    cameraRotation: Vec3
    objectPosition: Vec3
    objectRotation: Vec3
    sceneRotation: Vec3
    enableMouseMove: boolean
    enableMouseClick: boolean
    force: ForceProps
}

interface Particle {
    currentPosition: THREE.Vector3
    sourcePosition: THREE.Vector3
    targetPosition: THREE.Vector3
    velocity: THREE.Vector3
    currentColor: THREE.Color
    sourceColor: THREE.Color
    targetColor: THREE.Color
    attractorPosition: THREE.Vector3
    burstPosition: THREE.Vector3
    sphereTargetPosition: THREE.Vector3
    mouseBurstPosition: THREE.Vector3
}

const easeInOutCubic = (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

const ImageParticleEffect: React.FC<ImageParticleEffectProps> = (props) => {
    const {
        sourceImageUrl,
        targetImageUrl,
        morphState,
        morphDirection,
        onMorphComplete,
        enableMouseMove,
        enableMouseClick,
        force,
    } = props
    const mountRef = useRef<HTMLDivElement>(null)

    const particlesRef = useRef<Particle[]>([])
    const targetParticleDataRef = useRef<
        { position: THREE.Vector3; color: THREE.Color }[] | null
    >(null)
    const instancedMeshRef = useRef<THREE.InstancedMesh | null>(null)
    const objectGroupRef = useRef<THREE.Group | null>(null)
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
    const sceneRef = useRef<THREE.Scene | null>(null)
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
    const animationFrameIdRef = useRef<number | null>(null)
    const onMorphCompleteRef = useRef(onMorphComplete)
    const mouseInteractionStateRef = useRef<"none" | "bursting" | "attracting">(
        "none"
    )
    const mouseInteractionStartTimeRef = useRef<number>(0)

    const animatedPropsRef = useRef({
        cameraPosition: new THREE.Vector3(
            props.cameraPosition.x,
            props.cameraPosition.y,
            props.cameraPosition.z
        ),
        cameraRotation: new THREE.Euler(
            THREE.MathUtils.degToRad(props.cameraRotation.x),
            THREE.MathUtils.degToRad(props.cameraRotation.y),
            THREE.MathUtils.degToRad(props.cameraRotation.z)
        ),
        objectPosition: new THREE.Vector3(
            props.objectPosition.x,
            props.objectPosition.y,
            props.objectPosition.z
        ),
        objectRotation: new THREE.Euler(
            THREE.MathUtils.degToRad(props.objectRotation.x),
            THREE.MathUtils.degToRad(props.objectRotation.y),
            THREE.MathUtils.degToRad(props.objectRotation.z)
        ),
        sceneRotation: new THREE.Euler(
            THREE.MathUtils.degToRad(props.sceneRotation.x),
            THREE.MathUtils.degToRad(props.sceneRotation.y),
            THREE.MathUtils.degToRad(props.sceneRotation.z)
        ),
        force: { ...props.force },
    })
    const targetPropsRef = useRef(props)

    useEffect(() => {
        targetPropsRef.current = props
    }, [props])

    useEffect(() => {
        onMorphCompleteRef.current = onMorphComplete
    }, [onMorphComplete])

    const morphStateRef = useRef({
        isMorphing: false,
        startTime: 0,
        direction: null as MorphDirection,
        duration: 4000,
        phaseOneDuration: 1300,
        phaseTwoDuration: 1300,
    })

    const getImageParticleData = useCallback(
        (
            image: HTMLImageElement,
            density: number,
            onComplete: (
                data: { position: THREE.Vector3; color: THREE.Color }[]
            ) => void
        ) => {
            const data: { position: THREE.Vector3; color: THREE.Color }[] = []
            const MAX_WIDTH = 400
            const MAX_HEIGHT = 400
            let imgWidth = image.width
            let imgHeight = image.height

            const ratio = Math.min(MAX_WIDTH / imgWidth, MAX_HEIGHT / imgHeight)
            imgWidth = Math.floor(imgWidth * ratio)
            imgHeight = Math.floor(imgHeight * ratio)

            const canvas = document.createElement("canvas")
            const context = canvas.getContext("2d")
            if (!context) return

            canvas.width = imgWidth
            canvas.height = imgHeight
            context.drawImage(image, 0, 0, imgWidth, imgHeight)

            const imageData = context.getImageData(
                0,
                0,
                imgWidth,
                imgHeight
            ).data

            for (let y = 0; y < imgHeight; y += density) {
                for (let x = 0; x < imgWidth; x += density) {
                    const index = (y * imgWidth + x) * 4
                    const alpha = imageData[index + 3]

                    if (alpha > 128) {
                        const posX = x - imgWidth / 2
                        const posY = -y + imgHeight / 2
                        const color = new THREE.Color()
                        color.setRGB(
                            imageData[index] / 255,
                            imageData[index + 1] / 255,
                            imageData[index + 2] / 255
                        )
                        color.convertSRGBToLinear()
                        data.push({
                            position: new THREE.Vector3(posX, posY, 0),
                            color: color,
                        })
                    }
                }
            }
            onComplete(data)
        },
        []
    )

    useEffect(() => {
        if (!mountRef.current) return
        const currentMount = mountRef.current

        const isInitialized = rendererRef.current !== null
        if (isInitialized) return

        sceneRef.current = new THREE.Scene()
        cameraRef.current = new THREE.PerspectiveCamera(
            75,
            currentMount.clientWidth / currentMount.clientHeight,
            0.1,
            1000
        )
        cameraRef.current.position.z = 300
        rendererRef.current = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
        })
        rendererRef.current.setClearColor(0x000000, 0)
        rendererRef.current.setSize(
            currentMount.clientWidth,
            currentMount.clientHeight
        )
        rendererRef.current.setPixelRatio(window.devicePixelRatio)
        rendererRef.current.outputColorSpace = THREE.SRGBColorSpace
        currentMount.appendChild(rendererRef.current.domElement)

        const objectGroup = new THREE.Group()
        sceneRef.current.add(objectGroup)
        objectGroupRef.current = objectGroup

        const mouse = new THREE.Vector2(-1000, -1000)
        const handleMouseMove = (event: MouseEvent) => {
            const rect = rendererRef.current!.domElement.getBoundingClientRect()
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
        }
        const handleMouseDown = () => {
            mouseInteractionStateRef.current = "bursting"
            mouseInteractionStartTimeRef.current = performance.now()
            const burstRadius = 150
            const sphereRadius = 120

            particlesRef.current.forEach((p) => {
                p.mouseBurstPosition
                    .copy(p.currentPosition)
                    .add(
                        new THREE.Vector3(
                            (Math.random() - 0.5) * burstRadius,
                            (Math.random() - 0.5) * burstRadius,
                            (Math.random() - 0.5) * burstRadius
                        )
                    )
                const r = sphereRadius * Math.cbrt(Math.random())
                const theta = Math.random() * 2 * Math.PI
                const phi = Math.acos(2 * Math.random() - 1)
                p.sphereTargetPosition.setFromSphericalCoords(r, phi, theta)
            })
        }
        const handleMouseUp = () => {
            mouseInteractionStateRef.current = "none"
        }

        if (enableMouseMove)
            window.addEventListener("mousemove", handleMouseMove)
        if (enableMouseClick) {
            window.addEventListener("mousedown", handleMouseDown)
            window.addEventListener("mouseup", handleMouseUp)
        }

        const mouse3D = new THREE.Vector3()
        const dummy = new THREE.Object3D()
        const animate = () => {
            animationFrameIdRef.current = requestAnimationFrame(animate)
            if (
                !cameraRef.current ||
                !sceneRef.current ||
                !rendererRef.current ||
                !instancedMeshRef.current ||
                particlesRef.current.length === 0
            )
                return

            const animated = animatedPropsRef.current
            const target = targetPropsRef.current
            const lerpFactor = 0.05

            // Animate props
            animated.cameraPosition.lerp(
                new THREE.Vector3(
                    target.cameraPosition.x,
                    target.cameraPosition.y,
                    target.cameraPosition.z
                ),
                lerpFactor
            )
            animated.cameraRotation.x = THREE.MathUtils.lerp(
                animated.cameraRotation.x,
                THREE.MathUtils.degToRad(target.cameraRotation.x),
                lerpFactor
            )
            animated.cameraRotation.y = THREE.MathUtils.lerp(
                animated.cameraRotation.y,
                THREE.MathUtils.degToRad(target.cameraRotation.y),
                lerpFactor
            )
            animated.cameraRotation.z = THREE.MathUtils.lerp(
                animated.cameraRotation.z,
                THREE.MathUtils.degToRad(target.cameraRotation.z),
                lerpFactor
            )

            animated.objectPosition.lerp(
                new THREE.Vector3(
                    target.objectPosition.x,
                    target.objectPosition.y,
                    target.objectPosition.z
                ),
                lerpFactor
            )
            animated.objectRotation.x = THREE.MathUtils.lerp(
                animated.objectRotation.x,
                THREE.MathUtils.degToRad(target.objectRotation.x),
                lerpFactor
            )
            animated.objectRotation.y = THREE.MathUtils.lerp(
                animated.objectRotation.y,
                THREE.MathUtils.degToRad(target.objectRotation.y),
                lerpFactor
            )
            animated.objectRotation.z = THREE.MathUtils.lerp(
                animated.objectRotation.z,
                THREE.MathUtils.degToRad(target.objectRotation.z),
                lerpFactor
            )

            animated.sceneRotation.x = THREE.MathUtils.lerp(
                animated.sceneRotation.x,
                THREE.MathUtils.degToRad(target.sceneRotation.x),
                lerpFactor
            )
            animated.sceneRotation.y = THREE.MathUtils.lerp(
                animated.sceneRotation.y,
                THREE.MathUtils.degToRad(target.sceneRotation.y),
                lerpFactor
            )
            animated.sceneRotation.z = THREE.MathUtils.lerp(
                animated.sceneRotation.z,
                THREE.MathUtils.degToRad(target.sceneRotation.z),
                lerpFactor
            )

            animated.force.returnStrength = THREE.MathUtils.lerp(
                animated.force.returnStrength,
                target.force.returnStrength,
                lerpFactor
            )
            animated.force.damping = THREE.MathUtils.lerp(
                animated.force.damping,
                target.force.damping,
                lerpFactor
            )
            animated.force.pushRadius = THREE.MathUtils.lerp(
                animated.force.pushRadius,
                target.force.pushRadius,
                lerpFactor
            )
            animated.force.pushStrength = THREE.MathUtils.lerp(
                animated.force.pushStrength,
                target.force.pushStrength,
                lerpFactor
            )
            animated.force.particleSize = THREE.MathUtils.lerp(
                animated.force.particleSize,
                target.force.particleSize,
                lerpFactor
            )

            cameraRef.current.position.copy(animated.cameraPosition)
            cameraRef.current.rotation.copy(animated.cameraRotation)

            if (objectGroupRef.current) {
                objectGroupRef.current.position.copy(animated.objectPosition)
                objectGroupRef.current.rotation.copy(animated.objectRotation)
            }
            sceneRef.current.rotation.copy(animated.sceneRotation)

            mouse3D.set(mouse.x, mouse.y, 0.5)
            mouse3D.unproject(cameraRef.current)
            const dir = mouse3D.sub(cameraRef.current.position).normalize()
            const distance = -cameraRef.current.position.z / dir.z
            const pos = cameraRef.current.position
                .clone()
                .add(dir.multiplyScalar(distance))

            let needsColorUpdate = false

            const mouseState = mouseInteractionStateRef.current
            const mouseInteractionBurstDuration = 400

            if (mouseState !== "none" && target.enableMouseClick) {
                const interactionElapsedTime =
                    performance.now() - mouseInteractionStartTimeRef.current
                particlesRef.current.forEach((p, i) => {
                    let targetPosition: THREE.Vector3 | null = null
                    let lerpFactor = 0.04
                    if (mouseState === "bursting") {
                        if (
                            interactionElapsedTime >
                            mouseInteractionBurstDuration
                        ) {
                            mouseInteractionStateRef.current = "attracting"
                        }
                        targetPosition = p.mouseBurstPosition
                        lerpFactor = 0.08
                    } else if (mouseState === "attracting") {
                        targetPosition = pos.clone().add(p.sphereTargetPosition)
                        lerpFactor = 0.04
                    }
                    if (targetPosition) {
                        const oldPosition = p.currentPosition.clone()
                        p.currentPosition.lerp(targetPosition, lerpFactor)
                        p.velocity.subVectors(p.currentPosition, oldPosition)
                        dummy.position.copy(p.currentPosition)
                        dummy.updateMatrix()
                        instancedMeshRef.current!.setMatrixAt(i, dummy.matrix)
                    }
                })
                instancedMeshRef.current!.instanceMatrix.needsUpdate = true
                rendererRef.current.render(sceneRef.current, cameraRef.current)
                return
            }

            const morphState = morphStateRef.current
            if (morphState.isMorphing) {
                const elapsedTime = performance.now() - morphState.startTime
                const {
                    duration,
                    phaseOneDuration,
                    phaseTwoDuration,
                    direction,
                } = morphState
                const phaseTwoEndTime = phaseOneDuration + phaseTwoDuration

                if (elapsedTime >= duration) {
                    particlesRef.current.forEach((p) => {
                        p.attractorPosition.copy(
                            direction === "toTarget"
                                ? p.targetPosition
                                : p.sourcePosition
                        )
                        p.currentColor.copy(
                            direction === "toTarget"
                                ? p.targetColor
                                : p.sourceColor
                        )
                    })
                    morphState.isMorphing = false
                    onMorphCompleteRef.current(direction!)
                    needsColorUpdate = true
                } else {
                    const sphereRadius = 180
                    const totalProgress = easeInOutCubic(elapsedTime / duration)
                    particlesRef.current.forEach((p, i) => {
                        const startColor =
                            direction === "toTarget"
                                ? p.sourceColor
                                : p.targetColor
                        const endColor =
                            direction === "toTarget"
                                ? p.targetColor
                                : p.sourceColor
                        p.currentColor
                            .copy(startColor)
                            .lerp(endColor, totalProgress)
                        needsColorUpdate = true
                        const currentStartPos =
                            direction === "toTarget"
                                ? p.sourcePosition
                                : p.targetPosition
                        const currentEndPos =
                            direction === "toTarget"
                                ? p.targetPosition
                                : p.sourcePosition
                        const phi = Math.acos(
                            -1 + (2 * i) / particlesRef.current.length
                        )
                        const theta =
                            Math.sqrt(particlesRef.current.length * Math.PI) *
                            phi
                        const spherePos =
                            new THREE.Vector3().setFromSphericalCoords(
                                sphereRadius,
                                phi,
                                theta
                            )

                        if (elapsedTime < phaseOneDuration) {
                            const progress = easeInOutCubic(
                                elapsedTime / phaseOneDuration
                            )
                            p.attractorPosition.lerpVectors(
                                currentStartPos,
                                p.burstPosition,
                                progress
                            )
                        } else if (elapsedTime < phaseTwoEndTime) {
                            const progress = easeInOutCubic(
                                (elapsedTime - phaseOneDuration) /
                                    phaseTwoDuration
                            )
                            p.attractorPosition.lerpVectors(
                                p.burstPosition,
                                spherePos,
                                progress
                            )
                        } else {
                            const phaseThreeDuration =
                                duration - phaseTwoEndTime
                            const progress = easeInOutCubic(
                                (elapsedTime - phaseTwoEndTime) /
                                    phaseThreeDuration
                            )
                            const intermediatePos =
                                new THREE.Vector3().lerpVectors(
                                    spherePos,
                                    currentEndPos,
                                    progress
                                )
                            const travelVector = new THREE.Vector3().subVectors(
                                currentEndPos,
                                spherePos
                            )
                            const swirlAxis = new THREE.Vector3(
                                0.3,
                                -0.4,
                                0.8
                            ).normalize()
                            const perpendicular = new THREE.Vector3()
                                .crossVectors(travelVector, swirlAxis)
                                .normalize()
                            if (perpendicular.lengthSq() < 0.1) {
                                perpendicular.set(0, 1, 0)
                            }
                            const swirlAmplitude =
                                travelVector.length() *
                                0.3 *
                                Math.sin(progress * Math.PI)
                            const swirlOffset =
                                perpendicular.multiplyScalar(swirlAmplitude)
                            p.attractorPosition
                                .copy(intermediatePos)
                                .add(swirlOffset)
                        }
                    })
                }
            }

            const {
                returnStrength,
                damping,
                pushRadius,
                pushStrength,
                particleSize,
            } = animated.force

            for (let i = 0; i < particlesRef.current.length; i++) {
                const p = particlesRef.current[i]
                if (
                    target.enableMouseMove &&
                    mouseInteractionStateRef.current === "none"
                ) {
                    const distanceToMouse = p.currentPosition.distanceTo(pos)
                    if (distanceToMouse < pushRadius) {
                        const force = new THREE.Vector3()
                            .subVectors(p.currentPosition, pos)
                            .normalize()
                            .multiplyScalar(
                                (pushRadius - distanceToMouse) / pushRadius
                            )
                            .multiplyScalar(pushStrength)
                        p.velocity.add(force)
                    }
                }
                const returnForce = new THREE.Vector3()
                    .subVectors(p.attractorPosition, p.currentPosition)
                    .multiplyScalar(returnStrength)
                p.velocity.add(returnForce)
                p.velocity.multiplyScalar(damping)
                p.currentPosition.add(p.velocity)

                if (needsColorUpdate)
                    instancedMeshRef.current.setColorAt(i, p.currentColor)
                dummy.position.copy(p.currentPosition)
                dummy.scale.set(particleSize, particleSize, particleSize)
                dummy.updateMatrix()
                instancedMeshRef.current.setMatrixAt(i, dummy.matrix)
            }

            instancedMeshRef.current.instanceMatrix.needsUpdate = true
            if (needsColorUpdate) {
                instancedMeshRef.current.instanceColor!.needsUpdate = true
            }

            rendererRef.current.render(sceneRef.current, cameraRef.current)
        }

        animate()

        const handleResize = () => {
            if (!rendererRef.current || !cameraRef.current) return
            const width = currentMount.clientWidth
            const height = currentMount.clientHeight
            rendererRef.current.setSize(width, height)
            cameraRef.current.aspect = width / height
            cameraRef.current.updateProjectionMatrix()
        }
        window.addEventListener("resize", handleResize)

        return () => {
            window.removeEventListener("resize", handleResize)
            if (enableMouseMove)
                window.removeEventListener("mousemove", handleMouseMove)
            if (enableMouseClick) {
                window.removeEventListener("mousedown", handleMouseDown)
                window.removeEventListener("mouseup", handleMouseUp)
            }
            if (animationFrameIdRef.current) {
                cancelAnimationFrame(animationFrameIdRef.current)
            }
            if (rendererRef.current) {
                // Do not remove the renderer DOM element on cleanup to persist the canvas
            }
        }
    }, [enableMouseMove, enableMouseClick]) // Only run for setup and listeners

    useEffect(() => {
        const loader = new THREE.ImageLoader()
        loader.setCrossOrigin("Anonymous")
        loader.load(sourceImageUrl, (image) => {
            getImageParticleData(image, force.particleDensity, (sourceData) => {
                if (sourceData.length === 0) return

                if (!instancedMeshRef.current) {
                    // --- INITIAL LOAD ---
                    particlesRef.current = sourceData.map((data) => ({
                        currentPosition: data.position.clone(),
                        sourcePosition: data.position.clone(),
                        targetPosition: data.position.clone(),
                        velocity: new THREE.Vector3(0, 0, 0),
                        currentColor: data.color.clone(),
                        sourceColor: data.color.clone(),
                        targetColor: data.color.clone(),
                        attractorPosition: data.position.clone(),
                        burstPosition: new THREE.Vector3(),
                        sphereTargetPosition: new THREE.Vector3(),
                        mouseBurstPosition: new THREE.Vector3(),
                    }))

                    const particleCount = particlesRef.current.length
                    const particleGeometry = new THREE.CircleGeometry(1, 6)
                    const particleMaterial = new THREE.MeshBasicMaterial()
                    instancedMeshRef.current = new THREE.InstancedMesh(
                        particleGeometry,
                        particleMaterial,
                        particleCount
                    )
                    instancedMeshRef.current.instanceMatrix.setUsage(
                        THREE.DynamicDrawUsage
                    )

                    const dummy = new THREE.Object3D()
                    for (let i = 0; i < particleCount; i++) {
                        const p = particlesRef.current[i]
                        dummy.position.copy(p.currentPosition)
                        dummy.updateMatrix()
                        instancedMeshRef.current.setMatrixAt(i, dummy.matrix)
                        instancedMeshRef.current.setColorAt(i, p.currentColor)
                    }
                    objectGroupRef.current?.add(instancedMeshRef.current)
                } else {
                    // --- UPDATE SOURCE IMAGE ---
                    const existingParticles = particlesRef.current
                    const numParticles = Math.min(
                        existingParticles.length,
                        sourceData.length
                    )

                    for (let i = 0; i < numParticles; i++) {
                        existingParticles[i].sourcePosition.copy(
                            sourceData[i].position
                        )
                        existingParticles[i].sourceColor.copy(
                            sourceData[i].color
                        )
                    }
                    if (existingParticles.length > numParticles) {
                        for (
                            let i = numParticles;
                            i < existingParticles.length;
                            i++
                        ) {
                            const sourceIndex = i % numParticles
                            existingParticles[i].sourcePosition.copy(
                                sourceData[sourceIndex].position
                            )
                            existingParticles[i].sourceColor.copy(
                                sourceData[sourceIndex].color
                            )
                        }
                    }

                    if (
                        morphState === "source" &&
                        !morphStateRef.current.isMorphing
                    ) {
                        existingParticles.forEach((p) => {
                            p.attractorPosition.copy(p.sourcePosition)
                        })
                    }
                }
            })
        })
    }, [
        sourceImageUrl,
        force.particleDensity,
        getImageParticleData,
        morphState,
    ])

    useEffect(() => {
        if (targetImageUrl) {
            const loader = new THREE.ImageLoader()
            loader.setCrossOrigin("Anonymous")
            loader.load(targetImageUrl, (image) => {
                getImageParticleData(
                    image,
                    force.particleDensity,
                    (targetData) => {
                        targetParticleDataRef.current = targetData
                        if (
                            targetData.length === 0 ||
                            particlesRef.current.length === 0
                        )
                            return

                        // --- UPDATE TARGET IMAGE ---
                        const existingParticles = particlesRef.current
                        const numParticles = Math.min(
                            existingParticles.length,
                            targetData.length
                        )

                        for (let i = 0; i < numParticles; i++) {
                            existingParticles[i].targetPosition.copy(
                                targetData[i].position
                            )
                            existingParticles[i].targetColor.copy(
                                targetData[i].color
                            )
                        }
                        if (existingParticles.length > numParticles) {
                            for (
                                let i = numParticles;
                                i < existingParticles.length;
                                i++
                            ) {
                                const targetIndex = i % numParticles
                                existingParticles[i].targetPosition.copy(
                                    targetData[targetIndex].position
                                )
                                existingParticles[i].targetColor.copy(
                                    targetData[targetIndex].color
                                )
                            }
                        }

                        if (
                            morphState === "target" &&
                            !morphStateRef.current.isMorphing
                        ) {
                            existingParticles.forEach((p) => {
                                p.attractorPosition.copy(p.targetPosition)
                            })
                        }
                    }
                )
            })
        }
    }, [
        targetImageUrl,
        getImageParticleData,
        force.particleDensity,
        morphState,
    ])

    useEffect(() => {
        if (morphDirection && targetParticleDataRef.current) {
            const sourceParticles = particlesRef.current
            const targetParticles = targetParticleDataRef.current
            if (sourceParticles.length === 0 || targetParticles.length === 0)
                return

            // Ensure target positions are up-to-date before morphing
            const numParticles = Math.min(
                sourceParticles.length,
                targetParticles.length
            )
            for (let i = 0; i < numParticles; i++) {
                sourceParticles[i].targetPosition.copy(
                    targetParticles[i].position
                )
                sourceParticles[i].targetColor.copy(targetParticles[i].color)
            }
            if (sourceParticles.length > numParticles) {
                for (let i = numParticles; i < sourceParticles.length; i++) {
                    const targetIndex = i % numParticles
                    sourceParticles[i].targetPosition.copy(
                        targetParticles[targetIndex].position
                    )
                    sourceParticles[i].targetColor.copy(
                        targetParticles[targetIndex].color
                    )
                }
            }

            particlesRef.current.forEach((p) => {
                const burstRadius = 300
                const currentPos =
                    morphDirection === "toTarget"
                        ? p.sourcePosition
                        : p.targetPosition
                p.burstPosition
                    .copy(currentPos)
                    .add(
                        new THREE.Vector3(
                            (Math.random() - 0.5) * burstRadius,
                            (Math.random() - 0.5) * burstRadius,
                            (Math.random() - 0.5) * burstRadius
                        )
                    )
            })

            morphStateRef.current.isMorphing = true
            morphStateRef.current.startTime = performance.now()
            morphStateRef.current.direction = morphDirection
        }
    }, [morphDirection])

    return (
        <div
            ref={mountRef}
            style={{
                width: "100%",
                height: "100%",
                position: "absolute",
                top: 0,
                left: 0,
                overflow: "hidden",
            }}
        />
    )
}

const defaultProps = {
    width: 600,
    height: 600,
    sourceImage:
        "data:image/svg+xml,%3csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3e%3ccircle cx='50' cy='50' r='45' fill='white'/%3e%3c/svg%3e",
    targetImage:
        "data:image/svg+xml,%3csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3e%3crect width='90' height='90' x='5' y='5' fill='white'/%3e%3c/svg%3e",
    morphState: "source" as "source" | "target",
    cameraPosition: { x: 0, y: 0, z: 300 },
    cameraRotation: { x: 0, y: 0, z: 0 },
    objectPosition: { x: 0, y: 0, z: 0 },
    objectRotation: { x: 0, y: 0, z: 0 },
    sceneRotation: { x: 0, y: 0, z: 0 },
    enableMouseMove: true,
    enableMouseClick: true,
    force: {
        returnStrength: 0.02,
        damping: 0.92,
        pushRadius: 60,
        pushStrength: 0.8,
        particleSize: 1.25,
        particleDensity: 2,
    },
}

export function FramerImageParticleEffect(props: typeof defaultProps) {
    const { width, height, morphState, sourceImage, targetImage, ...rest } =
        props

    const [morphDirection, setMorphDirection] = useState<
        "toTarget" | "toSource" | null
    >(null)
    const [prevMorphState, setPrevMorphState] = useState(morphState)

    useEffect(() => {
        if (morphState !== prevMorphState) {
            setMorphDirection(morphState === "target" ? "toTarget" : "toSource")
            setPrevMorphState(morphState)
        }
    }, [morphState, prevMorphState])

    const handleMorphComplete = useCallback(() => {
        setMorphDirection(null)
    }, [])

    return (
        <div style={{ width, height, background: "transparent" }}>
            <ImageParticleEffect
                sourceImageUrl={sourceImage}
                targetImageUrl={targetImage}
                morphState={morphState}
                {...rest}
                morphDirection={morphDirection}
                onMorphComplete={handleMorphComplete}
            />
        </div>
    )
}

FramerImageParticleEffect.defaultProps = defaultProps

addPropertyControls(FramerImageParticleEffect, {
    sourceImage: {
        type: ControlType.Image,
        title: "Source",
    },
    targetImage: {
        type: ControlType.Image,
        title: "Target",
    },
    morphState: {
        type: ControlType.SegmentedEnum,
        title: "State",
        options: ["source", "target"],
        optionTitles: ["Source", "Target"],
        defaultValue: "source",
    },
    force: {
        type: ControlType.Object,
        title: "Forces",
        controls: {
            returnStrength: {
                type: ControlType.Number,
                title: "Return",
                defaultValue: 0.02,
                min: 0,
                max: 0.2,
                step: 0.001,
            },
            damping: {
                type: ControlType.Number,
                title: "Damping",
                defaultValue: 0.92,
                min: 0.8,
                max: 1,
                step: 0.01,
            },
            pushRadius: {
                type: ControlType.Number,
                title: "Mouse Radius",
                defaultValue: 60,
                min: 0,
                max: 200,
                step: 1,
            },
            pushStrength: {
                type: ControlType.Number,
                title: "Mouse Force",
                defaultValue: 0.8,
                min: 0,
                max: 5,
                step: 0.1,
            },
            particleSize: {
                type: ControlType.Number,
                title: "Size",
                defaultValue: 1.25,
                min: 0.1,
                max: 10,
                step: 0.05,
            },
            particleDensity: {
                type: ControlType.Number,
                title: "Density",
                defaultValue: 2,
                min: 1,
                max: 10,
                step: 1,
            },
        },
    },
    cameraPosition: {
        type: ControlType.Object,
        title: "Camera Position",
        controls: {
            x: { type: ControlType.Number, defaultValue: 0 },
            y: { type: ControlType.Number, defaultValue: 0 },
            z: { type: ControlType.Number, defaultValue: 300 },
        },
    },
    cameraRotation: {
        type: ControlType.Object,
        title: "Camera Rotation",
        controls: {
            x: {
                type: ControlType.Number,
                defaultValue: 0,
                min: -180,
                max: 180,
                unit: "°",
            },
            y: {
                type: ControlType.Number,
                defaultValue: 0,
                min: -180,
                max: 180,
                unit: "°",
            },
            z: {
                type: ControlType.Number,
                defaultValue: 0,
                min: -180,
                max: 180,
                unit: "°",
            },
        },
    },
    objectPosition: {
        type: ControlType.Object,
        title: "Object Position",
        controls: {
            x: { type: ControlType.Number, defaultValue: 0 },
            y: { type: ControlType.Number, defaultValue: 0 },
            z: { type: ControlType.Number, defaultValue: 0 },
        },
    },
    objectRotation: {
        type: ControlType.Object,
        title: "Object Rotation",
        controls: {
            x: {
                type: ControlType.Number,
                defaultValue: 0,
                min: -180,
                max: 180,
                unit: "°",
            },
            y: {
                type: ControlType.Number,
                defaultValue: 0,
                min: -180,
                max: 180,
                unit: "°",
            },
            z: {
                type: ControlType.Number,
                defaultValue: 0,
                min: -180,
                max: 180,
                unit: "°",
            },
        },
    },
    sceneRotation: {
        type: ControlType.Object,
        title: "Scene Rotation",
        controls: {
            x: {
                type: ControlType.Number,
                defaultValue: 0,
                min: -180,
                max: 180,
                unit: "°",
            },
            y: {
                type: ControlType.Number,
                defaultValue: 0,
                min: -180,
                max: 180,
                unit: "°",
            },
            z: {
                type: ControlType.Number,
                defaultValue: 0,
                min: -180,
                max: 180,
                unit: "°",
            },
        },
    },
    enableMouseMove: {
        type: ControlType.Boolean,
        title: "Mouse Move",
        defaultValue: true,
        enabledTitle: "On",
        disabledTitle: "Off",
    },
    enableMouseClick: {
        type: ControlType.Boolean,
        title: "Mouse Click",
        defaultValue: true,
        enabledTitle: "On",
        disabledTitle: "Off",
    },
})
