import { Game } from './game.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/loaders/GLTFLoader.js';

// Character Selection Logic
var nameInput = document.getElementById('nameInput');
var characterSelection = document.getElementById('characterSelection');
var backgroundSelection = document.getElementById('backgroundSelection');
var renderDiv = document.getElementById('renderDiv');
var selectedCharacter = null;
var selectedBackground = null;
var game = null;

// Check localStorage for existing user
function checkExistingUser() {
    var savedName = localStorage.getItem('playerName');

    if (savedName) {
        // User exists, skip name input and go to character selection
        characterSelection.style.display = 'flex';
        // Initialize previews after showing the screen
        setTimeout(function() {
            initializeCharacterPreviews();
        }, 50);
    } else {
        // New user, show name input
        nameInput.style.display = 'flex';
    }
}

// Handle name submission
var nameSubmitBtn = document.getElementById('nameSubmit');
if (nameSubmitBtn) {
    nameSubmitBtn.addEventListener('click', function() {
        var playerNameInput = document.getElementById('playerName');
        var playerName = playerNameInput.value.trim();

        if (playerName) {
            // Save name to localStorage
            localStorage.setItem('playerName', playerName);

            // Hide name input
            nameInput.style.display = 'none';

            // Show character selection
            characterSelection.style.display = 'flex';

            // Initialize previews after showing the screen
            setTimeout(function() {
                initializeCharacterPreviews();
            }, 50);
        } else {
            alert('Por favor ingresa tu nombre');
        }
    });
}

// Initialize on page load
checkExistingUser();

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

// Initialize character previews (will be called when character selection is shown)
var previewsInitialized = false;
function initializeCharacterPreviews() {
    if (!previewsInitialized) {
        createCharacterPreview('red', 'red-preview');
        createCharacterPreview('bumblebee', 'bumblebee-preview');
        previewsInitialized = true;
    }
}

// Handle character selection
var characterSelectButtons = document.querySelectorAll('#characterSelection .select-btn');
characterSelectButtons.forEach(function(button) {
    button.addEventListener('click', function(e) {
        var card = e.target.closest('.character-card');
        var chosenCharacter = card.getAttribute('data-character');
        selectedCharacter = chosenCharacter;
        console.log('Character selected:', chosenCharacter);

        // Hide character selection screen
        characterSelection.style.display = 'none';

        // Show background selection screen
        if (backgroundSelection) {
            backgroundSelection.style.display = 'flex';
        }
    });
});

// Handle background selection
var backgroundSelectButtons = document.querySelectorAll('#backgroundSelection .select-btn');
backgroundSelectButtons.forEach(function(button) {
    button.addEventListener('click', function(e) {
        var card = e.target.closest('.background-card');
        var chosenBackground = card.getAttribute('data-background');
        selectedBackground = chosenBackground;
        console.log('Background selected:', chosenBackground);

        // Hide background selection screen
        if (backgroundSelection) {
            backgroundSelection.style.display = 'none';
        }

        // Show loading screen
        var loadingScreen = document.getElementById('loadingScreen');
        if (loadingScreen) {
            loadingScreen.style.display = 'flex';
        }

        // Show game screen
        renderDiv.style.display = 'block';

        // Wait for DOM to update before initializing game
        setTimeout(function() {
            if (!renderDiv) {
                console.error('Fatal Error: renderDiv element not found.');
            } else {
                console.log('Initializing Game with character:', selectedCharacter, 'and background:', selectedBackground);

                // Check if user already has a name (skip onboarding if they do)
                var skipOnboarding = localStorage.getItem('playerName') !== null;

                game = new Game(renderDiv, selectedCharacter, selectedBackground, function() {
                    // Callback when game is fully loaded
                    if (loadingScreen) {
                        loadingScreen.classList.add('hidden');
                        setTimeout(function() {
                            loadingScreen.style.display = 'none';
                        }, 500); // Wait for fade-out animation
                    }
                }, skipOnboarding);
                game.start();
            }
        }, 100);
    });
});
