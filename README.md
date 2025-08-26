# Image to Fluid Particles

**Live Demo:** [https://conclusive-form-676715.framer.app/](https://conclusive-form-676715.framer.app/)

An interactive web application that transforms any image into a dynamic particle system. The particles react to the user's cursor with a fluid, physics-based push force and can morph between two different images.



---

## What is this? (Explain Like I'm 5)

Imagine you have a picture, like a drawing of a cat.

This app turns that picture into thousands of tiny, colorful dots, like a sand painting. But this sand is magical!

-   **It's Alive:** The dots gently float and shimmer.
-   **Mouse Interaction:** When you move your mouse over the dots, they get pushed away, like you're blowing on the sand. If you click and hold, the dots explode outwards and then swirl around your cursor like a tiny galaxy!
-   **Morphing Magic:** The coolest part is that you can upload a *second* picture, maybe a dog. When you press the "Morph" button, all the cat-dots will magically fly across the screen in beautiful swirls and rearrange themselves to form the picture of the dog! You can then press the button again to morph back into the cat.

It's like having a magical, interactive sand art animation right on your computer screen.

---

## Context Map: How It Works

This project combines React for the user interface with Three.js for the visual magic. Here’s a map of how the pieces fit together.

### 🗺️ The Big Picture

```
[ User ] <--> [ UI (React) ] <--> [ Visual Engine (Three.js) ]
   |                |                       |
   |           [ App.tsx ]         [ ImageParticleEffect.tsx ]
   |           (The Brains)          (The Magic Show)
   |                |                       |
   |       - Handles button clicks         - Turns images into dots
   |       - Manages which image is active - Animates every single dot
   |       - Tells the engine *when* to    - Handles mouse physics
   |         morph                       - Draws it all to the screen
```

### ⚙️ The Process Flow

1.  **Image to Data (`ImageParticleEffect.tsx`)**
    *   An image is loaded (e.g., `cat.png`).
    *   It's drawn onto a hidden `<canvas>` element in the browser.
    *   The code scans the canvas pixel by pixel. For every colored pixel it finds, it stores its position (x, y) and color (r, g, b).
    *   This list of positions and colors becomes the "blueprint" for the image. Each item in the list represents one particle.

2.  **The Scene (`ImageParticleEffect.tsx`)**
    *   A 3D scene is set up using **Three.js**.
    *   To draw thousands of particles efficiently, it uses an `InstancedMesh`. This is like telling the graphics card: "Here's one circle shape. Now draw it 10,000 times at these different positions and with these different colors." This is extremely fast.

3.  **The Animation Loop (`ImageParticleEffect.tsx`)**
    *   The magic happens in a function that runs about 60 times per second. In each frame, for *every single particle*, it does the following:
        *   **Apply Physics:** It calculates forces acting on the particle.
            *   *Return Force:* A gentle pull that tries to move the particle back to its "home" position in the original image blueprint.
            *   *Mouse Push Force:* If the mouse is close, a strong force pushes the particle away.
            *   *Mouse Click Force:* On click, particles are first pushed to a random "burst" position, then pulled into a sphere orbiting the mouse.
        *   **Update Position:** It updates the particle's position based on its current velocity and the forces applied.
        *   **Render:** It tells the `InstancedMesh` the new positions of all particles, and Three.js draws the updated scene to the screen.

4.  **Handling the UI (`App.tsx`)**
    *   This is the main React component. It renders the header, the "Upload" buttons, and the "Morph" button.
    *   It keeps track of the source image, the target image, and whether the app is currently morphing.
    *   When you click "Morph to Target", `App.tsx` simply tells `ImageParticleEffect.tsx` by passing a `morphDirection='toTarget'` prop.

5.  **The Morph Animation (`ImageParticleEffect.tsx`)**
    *   When the `morphDirection` prop is received, the animation loop enters a special "morphing" state.
    *   Instead of applying the simple "return force," it calculates a more complex path for each particle:
        1.  **Phase 1 (Burst):** Particles fly from their starting image position towards a random point in space to create a nice "exploding" effect.
        2.  **Phase 2 (Gather):** Particles move from their random burst point to a position on a giant, invisible sphere.
        3.  **Phase 3 (Resolve):** Particles travel from the sphere to their final destination in the target image blueprint, following a swirling path to make the transition look fluid and not just like a straight line.
    *   Once the animation is complete, it calls a function (`onMorphComplete`) to notify `App.tsx` that it's done.

---

## Technologies Used

-   **React:** For building the user interface and managing the application's state.
-   **Three.js:** A powerful 3D graphics library for creating and rendering the particle scene in WebGL.
-   **TypeScript:** For adding static types to JavaScript, making the code more robust and easier to maintain.
-   **HTML & CSS:** For the basic structure and styling of the application.
