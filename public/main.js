import { Game } from './game.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/loaders/GLTFLoader.js';

// Character Selection Logic
var characterSelection = document.getElementById('characterSelection');
var renderDiv = document.getElementById('renderDiv');
var selectedCharacter = null;
var game = null;

// Create preview scenes for each character
function createCharacterPreview(character, containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 2000);

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // Add lights
    var ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);
    var directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);
    var directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight2.position.set(-5, 5, -7.5);
    scene.add(directionalLight2);

    // Load character model
    var loader = new GLTFLoader();
    loader.load('assets/' + character + '.gltf', function(gltf) {
        var model = gltf.scene;

        // Calculate bounding box to properly scale and position
        var box = new THREE.Box3().setFromObject(model);
        var size = box.getSize(new THREE.Vector3());
        var center = box.getCenter(new THREE.Vector3());

        // Different scales and camera positions for different characters
        if (character === 'bumblebee') {
            // Bumblebee is a Transformer - should be bigger (like 2x taller than Red)
            var scale = 180 / Math.max(size.x, size.y, size.z);
            model.scale.set(scale, scale, scale);
            model.position.set(-center.x * scale, -center.y * scale - 20, -center.z * scale);
            camera.position.set(0, 0, 250);
        } else if (character === 'red') {
            // Red is an Angry Bird - smaller character
            var scale = 130 / Math.max(size.x, size.y, size.z);
            model.scale.set(scale, scale, scale);
            model.position.set(-center.x * scale, -center.y * scale - 20, -center.z * scale);
            camera.position.set(0, 0, 200);
        }

        scene.add(model);

        // Animation loop
        function animate() {
            requestAnimationFrame(animate);
            model.rotation.y += 0.01;
            renderer.render(scene, camera);
        }
        animate();
    });
}

// Initialize character previews
createCharacterPreview('red', 'red-preview');
createCharacterPreview('bumblebee', 'bumblebee-preview');

// Handle character selection
var selectButtons = document.querySelectorAll('.select-btn');
selectButtons.forEach(function(button) {
    button.addEventListener('click', function(e) {
        var card = e.target.closest('.character-card');
        selectedCharacter = card.getAttribute('data-character');

        // Hide character selection screen
        characterSelection.style.display = 'none';

        // Show game screen
        renderDiv.style.display = 'block';

        // Wait for DOM to update before initializing game
        setTimeout(function() {
            if (!renderDiv) {
                console.error('Fatal Error: renderDiv element not found.');
            } else {
                game = new Game(renderDiv, selectedCharacter);
                game.start();
            }
        }, 100);

    });
});
