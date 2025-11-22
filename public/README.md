# 3D Model Playground

Control 3D models using hand gestures and voice commands in real-time.

An interactive web app built with threejs, mediapipe computer vision, and web speech API.

- Say "drag", "rotate", "scale", or "animate" to change the interaction mode
- Pinch fingers to control the 3D model
- Drag/drop a new 3D model onto the page to import it (GLB/GLTF format)

[Video Demo](https://youtu.be/_I1E44Fp1Es) | [Live Demo](https://www.funwithcomputervision.com/demo4/)

## Setup for Development

```bash
# Navigate to the project sub-folder
#(follow the steps on the main page to clone all files if you haven't already done so)
cd 3d-model-playground

# Serve with your preferred method (example using Python)
python -m http.server

# Use your browser and go to:
http://localhost:8000
```

## Requirements

- Modern web browser with WebGL support
- Camera / microphone access

## Technologies

- **Three.js** for 3D rendering
- **MediaPipe** for hand tracking and gesture recognition
- **Web Speech API** for speech recognition
- **HTML5 Canvas** for visual feedback
- **JavaScript** for real-time interaction

## Key Learnings

[work in progress, to be added]