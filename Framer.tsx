import React, { useState, useEffect, useCallback, useRef } from "react"
import { addPropertyControls, ControlType } from "framer"
import * as THREE from "three"

type MorphDirection = "toTarget" | "toSource" | null
interface Vec3 {
    x: number
    y: number
    z: number
}

interface LightingProps {
    ambientLightColor: string
    ambientLightIntensity: number
    pointLightColor: string
    pointLightIntensity: number
    pointLightPosition: Vec3
}

interface ForceProps {
    returnStrength: number
    damping: number
    pushRadius: number
    pushStrength: number
    particleSize: number
    particleDensity: number
}

interface AppearanceProps {
    vibrancy: number
    exposure: number
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
    enablePushForce: boolean
    enableCollisions: boolean
    force: ForceProps
    lighting: LightingProps
    appearance: AppearanceProps
}

interface Particle {
    id: number
    currentPosition: THREE.Vector3
    sourcePosition: THREE.Vector3
    targetPosition: THREE.Vector3
    velocity: THREE.Vector3
    currentColor: THREE.Color
    sourceColor: THREE.Color
    targetColor: THREE.Color
    sourceBaseColor: THREE.Color
    targetBaseColor: THREE.Color
    attractorPosition: THREE.Vector3
    burstPosition: THREE.Vector3
    sphereTargetPosition: THREE.Vector3
    mouseBurstPosition: THREE.Vector3
}

const easeInOutCubic = (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

const applyVibrancy = (color: THREE.Color, vibrancy: number): THREE.Color => {
    const hsl = { h: 0, s: 0, l: 0 }
    color.getHSL(hsl)
    hsl.s = Math.min(1, hsl.s * vibrancy)
    color.setHSL(hsl.h, hsl.s, hsl.l)
    return color
}

const handleCollisions = (particles: Particle[], particleSize: number) => {
    if (particles.length < 2 || particleSize <= 0) return

    const collisionDist = particleSize * 2
    const collisionDistSq = collisionDist * collisionDist

    const gridCellSize = collisionDist
    const grid: Map<string, Particle[]> = new Map()

    const getCellKey = (p: THREE.Vector3) => {
        return `${Math.floor(p.x / gridCellSize)}_${Math.floor(
            p.y / gridCellSize
        )}_${Math.floor(p.z / gridCellSize)}`
    }

    for (const p of particles) {
        const key = getCellKey(p.currentPosition)
        if (!grid.has(key)) {
            grid.set(key, [])
        }
        grid.get(key)!.push(p)
    }

    const collisionNormal = new THREE.Vector3()
    const relativeVelocity = new THREE.Vector3()
    const correction = new THREE.Vector3()
    const impulse = new THREE.Vector3()

    for (const p1 of particles) {
        const p1x = Math.floor(p1.currentPosition.x / gridCellSize)
        const p1y = Math.floor(p1.currentPosition.y / gridCellSize)
        const p1z = Math.floor(p1.currentPosition.z / gridCellSize)

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const key = `${p1x + dx}_${p1y + dy}_${p1z + dz}`
                    const cell = grid.get(key)
                    if (cell) {
                        for (const p2 of cell) {
                            if (p1.id >= p2.id) continue

                            const distanceSq =
                                p1.currentPosition.distanceToSquared(
                                    p2.currentPosition
                                )

                            if (
                                distanceSq > 0 &&
                                distanceSq < collisionDistSq
                            ) {
                                const distance = Math.sqrt(distanceSq)
                                const overlap = (collisionDist - distance) * 0.5

                                collisionNormal
                                    .subVectors(
                                        p1.currentPosition,
                                        p2.currentPosition
                                    )
                                    .multiplyScalar(1 / distance)

                                correction
                                    .copy(collisionNormal)
                                    .multiplyScalar(overlap)
                                p1.currentPosition.add(correction)
                                p2.currentPosition.sub(correction)

                                relativeVelocity.subVectors(
                                    p1.velocity,
                                    p2.velocity
                                )
                                const velocityAlongNormal =
                                    relativeVelocity.dot(collisionNormal)

                                if (velocityAlongNormal > 0) continue

                                const restitution = 0.5
                                const impulseScalar =
                                    -(1 + restitution) * velocityAlongNormal

                                impulse
                                    .copy(collisionNormal)
                                    .multiplyScalar(impulseScalar * 0.5)
                                p1.velocity.add(impulse)
                                p2.velocity.sub(impulse)
                            }
                        }
                    }
                }
            }
        }
    }
}

const ImageParticleEffect: React.FC<ImageParticleEffectProps> = (props) => {
    const {
        sourceImageUrl,
        targetImageUrl,
        morphState,
        morphDirection,
        onMorphComplete,
        enablePushForce,
        enableCollisions,
        force,
        lighting,
        appearance,
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
    const ambientLightRef = useRef<THREE.AmbientLight | null>(null)
    const pointLightRef = useRef<THREE.PointLight | null>(null)
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
        lighting: {
            ambientLightColor: new THREE.Color(
                props.lighting.ambientLightColor
            ),
            ambientLightIntensity: props.lighting.ambientLightIntensity,
            pointLightColor: new THREE.Color(props.lighting.pointLightColor),
            pointLightIntensity: props.lighting.pointLightIntensity,
            pointLightPosition: new THREE.Vector3(
                props.lighting.pointLightPosition.x,
                props.lighting.pointLightPosition.y,
                props.lighting.pointLightPosition.z
            ),
        },
        appearance: { ...props.appearance },
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
        rendererRef.current.toneMapping = THREE.ACESFilmicToneMapping
        currentMount.appendChild(rendererRef.current.domElement)

        ambientLightRef.current = new THREE.AmbientLight()
        sceneRef.current.add(ambientLightRef.current)
        pointLightRef.current = new THREE.PointLight()
        sceneRef.current.add(pointLightRef.current)

        const objectGroup = new THREE.Group()
        sceneRef.current.add(objectGroup)
        objectGroupRef.current = objectGroup

        const mouse = new THREE.Vector2(-1000, -1000)

        const getPointerCoordinates = (event: MouseEvent | TouchEvent) => {
            if ("touches" in event && event.touches.length > 0) {
                return {
                    clientX: event.touches[0].clientX,
                    clientY: event.touches[0].clientY,
                }
            } else if ("clientX" in event) {
                return { clientX: event.clientX, clientY: event.clientY }
            }
            return null
        }

        const handlePointerMove = (event: MouseEvent | TouchEvent) => {
            const coords = getPointerCoordinates(event)
            if (!coords || !rendererRef.current) return
            const rect = rendererRef.current.domElement.getBoundingClientRect()
            mouse.x = ((coords.clientX - rect.left) / rect.width) * 2 - 1
            mouse.y = -((coords.clientY - rect.top) / rect.height) * 2 + 1
        }
        
        const handlePointerDown = () => {
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
        const handlePointerUp = () => {
            mouseInteractionStateRef.current = "none"
        }

        if (enablePushForce) {
            window.addEventListener("mousemove", handlePointerMove)
            window.addEventListener("touchmove", handlePointerMove, {
                passive: true,
            })
        }
        
        // Click interaction is always on
        window.addEventListener("mousedown", handlePointerDown)
        window.addEventListener("touchstart", handlePointerDown, {
            passive: true,
        })
        window.addEventListener("mouseup", handlePointerUp)
        window.addEventListener("touchend", handlePointerUp)

        const mouse3D = new THREE.Vector3()
        const forceVector = new THREE.Vector3()
        const returnForce = new THREE.Vector3()
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

            animated.lighting.ambientLightColor.lerp(
                new THREE.Color(target.lighting.ambientLightColor),
                lerpFactor
            )
            animated.lighting.ambientLightIntensity = THREE.MathUtils.lerp(
                animated.lighting.ambientLightIntensity,
                target.lighting.ambientLightIntensity,
                lerpFactor
            )
            animated.lighting.pointLightColor.lerp(
                new THREE.Color(target.lighting.pointLightColor),
                lerpFactor
            )
            animated.lighting.pointLightIntensity = THREE.MathUtils.lerp(
                animated.lighting.pointLightIntensity,
                target.lighting.pointLightIntensity,
                lerpFactor
            )
            animated.lighting.pointLightPosition.lerp(
                new THREE.Vector3(
                    target.lighting.pointLightPosition.x,
                    target.lighting.pointLightPosition.y,
                    target.lighting.pointLightPosition.z
                ),
                lerpFactor
            )

            const oldVibrancy = animated.appearance.vibrancy
            animated.appearance.vibrancy = THREE.MathUtils.lerp(
                animated.appearance.vibrancy,
                target.appearance.vibrancy,
                lerpFactor
            )
            const vibrancyChanged =
                Math.abs(animated.appearance.vibrancy - oldVibrancy) > 0.001

            animated.appearance.exposure = THREE.MathUtils.lerp(
                animated.appearance.exposure,
                target.appearance.exposure,
                lerpFactor
            )
            rendererRef.current.toneMappingExposure =
                animated.appearance.exposure

            if (ambientLightRef.current && pointLightRef.current) {
                ambientLightRef.current.color.copy(
                    animated.lighting.ambientLightColor
                )
                ambientLightRef.current.intensity =
                    animated.lighting.ambientLightIntensity
                pointLightRef.current.color.copy(
                    animated.lighting.pointLightColor
                )
                pointLightRef.current.intensity =
                    animated.lighting.pointLightIntensity
                pointLightRef.current.position.copy(
                    animated.lighting.pointLightPosition
                )
            }

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

            if (vibrancyChanged) {
                needsColorUpdate = true
                particlesRef.current.forEach((p) => {
                    applyVibrancy(
                        p.sourceColor.copy(p.sourceBaseColor),
                        animated.appearance.vibrancy
                    )
                    applyVibrancy(
                        p.targetColor.copy(p.targetBaseColor),
                        animated.appearance.vibrancy
                    )
                    if (!morphStateRef.current.isMorphing) {
                        if (morphState === "source") {
                            p.currentColor.copy(p.sourceColor)
                        } else {
                            p.currentColor.copy(p.targetColor)
                        }
                    }
                })
            }
            
            const mouseState = mouseInteractionStateRef.current
            const mouseInteractionBurstDuration = 400

            if (mouseState !== "none") {
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


            const currentMorphState = morphStateRef.current
            if (currentMorphState.isMorphing) {
                const elapsedTime =
                    performance.now() - currentMorphState.startTime
                const {
                    duration,
                    phaseOneDuration,
                    phaseTwoDuration,
                    direction,
                } = currentMorphState
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
                    currentMorphState.isMorphing = false
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

            if (target.enablePushForce && mouseInteractionStateRef.current === "none" && pushRadius > 0) {
                const pushRadiusSq = pushRadius * pushRadius
                const gridCellSize = pushRadius
                const grid: Map<string, Particle[]> = new Map()
                const getCellKey = (v: THREE.Vector3) =>
                    `${Math.floor(v.x / gridCellSize)}_${Math.floor(
                        v.y / gridCellSize
                    )}_${Math.floor(v.z / gridCellSize)}`

                for (const p of particlesRef.current) {
                    const key = getCellKey(p.currentPosition)
                    if (!grid.has(key)) grid.set(key, [])
                    grid.get(key)!.push(p)
                }

                const mouseX = Math.floor(pos.x / gridCellSize)
                const mouseY = Math.floor(pos.y / gridCellSize)
                const mouseZ = Math.floor(pos.z / gridCellSize)

                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dz = -1; dz <= 1; dz++) {
                            const key = `${mouseX + dx}_${mouseY + dy}_${
                                mouseZ + dz
                            }`
                            const cell = grid.get(key)
                            if (cell) {
                                for (const p of cell) {
                                    const distanceSq =
                                        p.currentPosition.distanceToSquared(pos)
                                    if (
                                        distanceSq > 1e-6 &&
                                        distanceSq < pushRadiusSq
                                    ) {
                                        const distance = Math.sqrt(distanceSq)
                                        const strength =
                                            (((pushRadius - distance) /
                                                pushRadius) *
                                                pushStrength) /
                                            distance
                                        forceVector
                                            .subVectors(p.currentPosition, pos)
                                            .multiplyScalar(strength)
                                        p.velocity.add(forceVector)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // First loop: apply forces & update positions
            for (let i = 0; i < particlesRef.current.length; i++) {
                const p = particlesRef.current[i]
                returnForce
                    .subVectors(p.attractorPosition, p.currentPosition)
                    .multiplyScalar(returnStrength)
                p.velocity.add(returnForce)
                p.velocity.multiplyScalar(damping)
                p.currentPosition.add(p.velocity)
            }

            // Handle collisions
            if (target.enableCollisions) {
                handleCollisions(particlesRef.current, particleSize)
            }

            // Second loop: update mesh
            for (let i = 0; i < particlesRef.current.length; i++) {
                const p = particlesRef.current[i]
                if (needsColorUpdate) {
                    instancedMeshRef.current.setColorAt(i, p.currentColor)
                }
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

        const resizeObserver = new ResizeObserver(handleResize)
        resizeObserver.observe(currentMount)

        return () => {
            resizeObserver.disconnect()
            if (enablePushForce) {
                window.removeEventListener("mousemove", handlePointerMove)
                window.removeEventListener("touchmove", handlePointerMove)
            }
            window.removeEventListener("mousedown", handlePointerDown)
            window.removeEventListener("touchstart", handlePointerDown)
            window.removeEventListener("mouseup", handlePointerUp)
            window.removeEventListener("touchend", handlePointerUp)
            if (animationFrameIdRef.current) {
                cancelAnimationFrame(animationFrameIdRef.current)
            }
        }
    }, [enablePushForce])

    useEffect(() => {
        const loader = new THREE.ImageLoader()
        loader.setCrossOrigin("Anonymous")
        loader.load(sourceImageUrl, (image) => {
            getImageParticleData(image, force.particleDensity, (sourceData) => {
                if (sourceData.length === 0) return

                if (!instancedMeshRef.current) {
                    // --- INITIAL LOAD ---
                    particlesRef.current = sourceData.map((data, i) => {
                        const vibrantColor = applyVibrancy(
                            data.color.clone(),
                            appearance.vibrancy
                        )
                        return {
                            id: i,
                            currentPosition: data.position.clone(),
                            sourcePosition: data.position.clone(),
                            targetPosition: data.position.clone(),
                            velocity: new THREE.Vector3(0, 0, 0),
                            currentColor: vibrantColor.clone(),
                            sourceColor: vibrantColor.clone(),
                            targetColor: vibrantColor.clone(),
                            sourceBaseColor: data.color.clone(),
                            targetBaseColor: data.color.clone(),
                            attractorPosition: data.position.clone(),
                            burstPosition: new THREE.Vector3(),
                            sphereTargetPosition: new THREE.Vector3(),
                            mouseBurstPosition: new THREE.Vector3(),
                        }
                    })

                    const particleCount = particlesRef.current.length
                    const particleGeometry = new THREE.SphereGeometry(
                        0.75,
                        8,
                        6
                    )
                    const particleMaterial = new THREE.MeshStandardMaterial({})
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
                        existingParticles[i].sourceBaseColor.copy(
                            sourceData[i].color
                        )
                        applyVibrancy(
                            existingParticles[i].sourceColor.copy(
                                sourceData[i].color
                            ),
                            appearance.vibrancy
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
                            existingParticles[i].sourceBaseColor.copy(
                                sourceData[sourceIndex].color
                            )
                            applyVibrancy(
                                existingParticles[i].sourceColor.copy(
                                    sourceData[sourceIndex].color
                                ),
                                appearance.vibrancy
                            )
                        }
                    }

                    if (
                        morphState === "source" &&
                        !morphStateRef.current.isMorphing
                    ) {
                        existingParticles.forEach((p) => {
                            p.attractorPosition.copy(p.sourcePosition)
                            p.currentColor.copy(p.sourceColor)
                        })
                        if (instancedMeshRef.current) {
                            instancedMeshRef.current.instanceColor!.needsUpdate =
                                true
                        }
                    }
                }
            })
        })
    }, [
        sourceImageUrl,
        force.particleDensity,
        getImageParticleData,
        morphState,
        appearance.vibrancy,
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
                            existingParticles[i].targetBaseColor.copy(
                                targetData[i].color
                            )
                            applyVibrancy(
                                existingParticles[i].targetColor.copy(
                                    targetData[i].color
                                ),
                                appearance.vibrancy
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
                                existingParticles[i].targetBaseColor.copy(
                                    targetData[targetIndex].color
                                )
                                applyVibrancy(
                                    existingParticles[i].targetColor.copy(
                                        targetData[targetIndex].color
                                    ),
                                    appearance.vibrancy
                                )
                            }
                        }

                        if (
                            morphState === "target" &&
                            !morphStateRef.current.isMorphing
                        ) {
                            existingParticles.forEach((p) => {
                                p.attractorPosition.copy(p.targetPosition)
                                p.currentColor.copy(p.targetColor)
                            })
                            if (instancedMeshRef.current) {
                                instancedMeshRef.current.instanceColor!.needsUpdate =
                                    true
                            }
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
        appearance.vibrancy,
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
                sourceParticles[i].targetBaseColor.copy(
                    targetParticles[i].color
                )
                applyVibrancy(
                    sourceParticles[i].targetColor.copy(
                        targetParticles[i].color
                    ),
                    appearance.vibrancy
                )
            }
            if (sourceParticles.length > numParticles) {
                for (let i = numParticles; i < sourceParticles.length; i++) {
                    const targetIndex = i % numParticles
                    sourceParticles[i].targetPosition.copy(
                        targetParticles[targetIndex].position
                    )
                    sourceParticles[i].targetBaseColor.copy(
                        targetParticles[targetIndex].color
                    )
                    applyVibrancy(
                        sourceParticles[i].targetColor.copy(
                            targetParticles[targetIndex].color
                        ),
                        appearance.vibrancy
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
    }, [morphDirection, appearance.vibrancy])

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
    enablePushForce: true,
    enableCollisions: true,
    force: {
        returnStrength: 0.02,
        damping: 0.92,
        pushRadius: 60,
        pushStrength: 0.8,
        particleSize: 1.25,
        particleDensity: 4,
    },
    lighting: {
        ambientLightColor: "#ffffff",
        ambientLightIntensity: 0.5,
        pointLightColor: "#ffffff",
        pointLightIntensity: 5,
        pointLightPosition: { x: 100, y: 100, z: 100 },
    },
    appearance: {
        vibrancy: 1.2,
        exposure: 1.0,
    },
}

/**
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight any-prefer-fixed
 * @framerIntrinsicWidth 600
 * @framerIntrinsicHeight 800
 * @framerDisableUnlink
 */

export function FramerImageParticleEffect(props: typeof defaultProps) {
    const {
        width,
        height,
        morphState,
        sourceImage,
        targetImage,
        appearance,
        ...rest
    } = props

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
                appearance={appearance}
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
    appearance: {
        type: ControlType.Object,
        title: "Appearance",
        controls: {
            vibrancy: {
                type: ControlType.Number,
                title: "Vibrancy",
                defaultValue: 1.2,
                min: 0,
                max: 3,
                step: 0.1,
            },
            exposure: {
                type: ControlType.Number,
                title: "Exposure",
                defaultValue: 1.0,
                min: 0,
                max: 3,
                step: 0.1,
            },
        },
    },
    enablePushForce: {
        type: ControlType.Boolean,
        title: "Push Force",
        defaultValue: true,
        enabledTitle: "On",
        disabledTitle: "Off",
    },
    enableCollisions: {
        type: ControlType.Boolean,
        title: "Collisions",
        defaultValue: true,
        enabledTitle: "On",
        disabledTitle: "Off",
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
                defaultValue: 4,
                min: 1,
                max: 10,
                step: 1,
            },
        },
    },
    lighting: {
        type: ControlType.Object,
        title: "Lighting",
        controls: {
            ambientLightColor: {
                type: ControlType.Color,
                title: "Ambient Color",
                defaultValue: "#ffffff",
            },
            ambientLightIntensity: {
                type: ControlType.Number,
                title: "Ambient Power",
                defaultValue: 0.5,
                min: 0,
                max: 2,
                step: 0.1,
            },
            pointLightColor: {
                type: ControlType.Color,
                title: "Point Color",
                defaultValue: "#ffffff",
            },
            pointLightIntensity: {
                type: ControlType.Number,
                title: "Point Power",
                defaultValue: 5,
                min: 0,
                max: 50,
                step: 0.1,
            },
            pointLightPosition: {
                type: ControlType.Object,
                title: "Point Position",
                controls: {
                    x: {
                        type: ControlType.Number,
                        defaultValue: 100,
                        min: -500,
                        max: 500,
                        step: 10,
                    },
                    y: {
                        type: ControlType.Number,
                        defaultValue: 100,
                        min: -500,
                        max: 500,
                        step: 10,
                    },
                    z: {
                        type: ControlType.Number,
                        defaultValue: 100,
                        min: -500,
                        max: 500,
                        step: 10,
                    },
                },
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
})