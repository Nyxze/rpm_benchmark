import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
// import './style.css'; // CSS is now linked directly in index.html

console.log('RPM + Three.js Demo (External GLB Animations): Script started');

const subdomain = 'demo'; // Replace with your subdomain
const frame = document.getElementById('avatar-creator');
const container = document.getElementById('container');
const sceneContainer = document.getElementById('scene-container');
const loadingText = document.getElementById('loading');
const createButton = document.getElementById('create-avatar');
const animationControlsContainer = document.getElementById('animation-controls');
const animationSelect = document.getElementById('animation-select'); // Get select element
const playAnimationButton = document.getElementById('play-animation-button'); // Get play button
const benchmarkControls = document.getElementById('benchmark-controls');
const characterCountInput = document.getElementById('character-count');
const instantiateButton = document.getElementById('instantiate-characters-button');
const runSuiteButton = document.getElementById('run-benchmark-suite-button');
const reportDisplay = document.getElementById('benchmark-report');

// --- Animation File Names (assuming .glb in public/animations/) ---
const animationFileNames = [
    'F_Dances_001.glb'
];

let externalAnimationClips = [];
let externalAnimationsLoaded = false;

// Three.js scene setup
let scene, camera, renderer, controls, clock;
let currentAvatarScene = null;
let currentAnimationMixer = null;
let instantiatedAvatars = [];

const stats = {
    fps: 0,
    frames: 0,
    lastTime: performance.now(),
};

let benchmarkConfig = [];
let isSuiteRunning = false;
let suiteResults = [];
let currentRunStats = null;

async function loadBenchmarkConfig() {
    try {
        const response = await fetch('/benchmark-config.json');
        benchmarkConfig = await response.json();
        console.log('RPM + Three.js Demo: Benchmark config loaded', benchmarkConfig);
    } catch (error) {
        console.error('RPM + Three.js Demo: Failed to load benchmark config, using defaults.', error);
    }
}

async function loadExternalAnimations() {
    console.log('RPM + Three.js Demo: Loading external GLB animations...');
    const loadedClips = [];
    for (const fileName of animationFileNames) {
        try {
            let  loader = new GLTFLoader();
            const filePath = `/animations/${fileName}`; // Path relative to public folder
            const gltf = await loader.loadAsync(filePath);
            if (gltf.animations && gltf.animations.length > 0) {
                gltf.animations.forEach(clip => {

                    clip.name = fileName.split('.')[0];
                    loadedClips.push(clip);
                    console.log(`RPM + Three.js Demo: Loaded external animation clip: ${clip.name} from ${fileName}`);
                });
            } else {
                console.warn(`RPM + Three.js Demo: No animations found in GLB file: ${fileName}`);
            }
        } catch (error) {
            console.error(`RPM + Three.js Demo: Failed to load GLB animation ${fileName}:`, error);
        }
    }
    externalAnimationClips = loadedClips;
    externalAnimationsLoaded = true;
    console.log('RPM + Three.js Demo: All external GLB animations processed.', externalAnimationClips);
    if (currentAvatarScene) {
        setupAnimationDropdown(); // Renamed call
    }
}

function setupAnimationDropdown() {
    console.log('RPM + Three.js Demo: Setting up animation dropdown.');
    if (!animationControlsContainer || !animationSelect || !playAnimationButton) { // Check for play button too
        console.error('RPM + Three.js Demo: HTML elements for animation controls (container, select, or button) not found!');
        if (animationControlsContainer) animationControlsContainer.style.display = 'flex';
        return;
    }

    animationControlsContainer.style.display = 'flex';
    benchmarkControls.style.display = 'flex';
    animationSelect.innerHTML = '';
    playAnimationButton.disabled = true; // Initially disable play button

    if (!externalAnimationsLoaded || externalAnimationClips.length === 0) {
        const msg = 'No external animations loaded.';
        console.warn(`RPM + Three.js Demo: ${msg}`, { externalAnimationsLoaded, clipsCount: externalAnimationClips.length });
        const option = document.createElement('option');
        option.textContent = msg;
        option.disabled = true;
        animationSelect.appendChild(option);
        animationSelect.disabled = true;
        return;
    }

    if (!currentAnimationMixer) {
        const msg = 'Avatar not ready for animations.';
        console.warn(`RPM + Three.js Demo: ${msg}`);
        const option = document.createElement('option');
        option.textContent = msg;
        option.disabled = true;
        animationSelect.appendChild(option);
        animationSelect.disabled = true;
        return;
    }

    animationSelect.disabled = false;
    const defaultOption = document.createElement('option');
    defaultOption.textContent = 'Select an animation...';
    defaultOption.value = '';
    defaultOption.selected = true;
    // defaultOption.disabled = true; // No longer make it permanently disabled, user might want to re-select it to stop animation / disable button
    animationSelect.appendChild(defaultOption);

    externalAnimationClips.forEach((clip, index) => {
        const option = document.createElement('option');
        option.textContent = clip.name || `Animation ${index + 1}`;
        option.value = index.toString();
        animationSelect.appendChild(option);
    });

    animationSelect.onchange = (event) => {
        const selectedValue = event.target.value;
        if (selectedValue !== '' && !isNaN(parseInt(selectedValue, 10))) {
            playAnimationButton.disabled = false; // Enable play button if a specific animation is selected
        } else {
            playAnimationButton.disabled = true; // Disable play button if "Select an animation..." is chosen
            if (currentAnimationMixer && selectedValue === '') { // Optionally stop animation if placeholder is re-selected
                currentAnimationMixer.stopAllAction();
                console.log('RPM + Three.js Demo: "Select an animation" chosen. Stopping animations.');
            }
        }
    };

    playAnimationButton.onclick = () => {
        const selectedIndex = parseInt(animationSelect.value, 10);
        if (!isNaN(selectedIndex) && selectedIndex >= 0 && selectedIndex < externalAnimationClips.length) {
            const selectedClip = externalAnimationClips[selectedIndex];
            playAnimation(selectedClip);
        } else {
            console.warn('RPM + Three.js Demo: No valid animation selected to play.');
        }
    };

    console.log('RPM + Three.js Demo: Animation dropdown and play button configured.');
}

function playAnimation(clip) {
    if (instantiatedAvatars.length > 0) {
        instantiatedAvatars.forEach(avatar => {
            if (avatar.mixer) {
                avatar.mixer.stopAllAction();
                const action = avatar.mixer.clipAction(clip);
                action.reset().play();
            }
        });
        console.log(`RPM + Three.js Demo: Playing animation on ${instantiatedAvatars.length} instantiated avatars.`);
    } else if (currentAnimationMixer) {
        console.log(`RPM + Three.js Demo: Playing animation: ${clip.name}, Duration: ${clip.duration}`);
        if (clip.tracks && clip.tracks.length > 0) {
            console.log(`RPM + Three.js Demo: First few track names:`);
            for (let i = 0; i < Math.min(clip.tracks.length, 3); i++) {
                console.log(`  - ${clip.tracks[i].name}`);
            }
        } else {
            console.warn('RPM + Three.js Demo: Selected clip has no tracks!');
        }

        currentAnimationMixer.stopAllAction();
        const action = currentAnimationMixer.clipAction(clip);
        action.reset().play();
    } else {
        console.warn('RPM + Three.js Demo: Animation mixer not available.');
    }
}

function initScene() {
    console.log('RPM + Three.js Demo: Initializing Three.js scene');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdedede);
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 2.5);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    sceneContainer.appendChild(renderer.domElement);
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(2, 3, 2);
    directionalLight.castShadow = true;
    scene.add(directionalLight);
    const hemisphereLight = new THREE.HemisphereLight(0xffffbb, 0x080820, 0.5);
    scene.add(hemisphereLight);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 1.0, 0);
    clock = new THREE.Clock();
    window.addEventListener('resize', onWindowResize, false);
    console.log('RPM + Three.js Demo: Starting animation loop');
    animate();
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (currentAnimationMixer) {
        currentAnimationMixer.update(delta);
    }
    if (instantiatedAvatars.length > 0) {
        instantiatedAvatars.forEach(avatar => {
            if (avatar.mixer) {
                avatar.mixer.update(delta);
            }
        });
    }
    controls.update();
    renderer.render(scene, camera);
    updateStats();
}

function onWindowResize() {
    console.log('RPM + Three.js Demo: Window resized');
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Hide original avatar to only show the grid
    currentAvatarScene.visible = false;
}

async function loadAvatar(url) {
    console.log(`RPM + Three.js Demo: Loading avatar GLB from URL: ${url}`);
    clearInstantiatedAvatars();
    const loader = new GLTFLoader();
    try {
        const gltf = await loader.loadAsync(url);
        console.log('RPM + Three.js Demo: Avatar GLTF data loaded', gltf);
        if (currentAvatarScene) {
            console.log('RPM + Three.js Demo: Disposing previous avatar scene');
            scene.remove(currentAvatarScene);
            if (currentAnimationMixer) currentAnimationMixer = null;
        }
        currentAvatarScene = gltf.scene;
        currentAvatarScene.visible = true; // Ensure new avatar is visible
        console.log('RPM + Three.js Demo: Adding GLTF scene to main scene');
        scene.add(currentAvatarScene);
        currentAnimationMixer = new THREE.AnimationMixer(currentAvatarScene);

        // Log avatar scene structure
        console.log('RPM + Three.js Demo: Avatar scene loaded. Root name:', currentAvatarScene.name);
        if (currentAvatarScene.children && currentAvatarScene.children.length > 0) {
            console.log('RPM + Three.js Demo: First few children of avatar scene:');
            for (let i = 0; i < Math.min(currentAvatarScene.children.length, 3); i++) {
                console.log(`  - Child ${i}: ${currentAvatarScene.children[i].name} (type: ${currentAvatarScene.children[i].type})`);
            }
        }
        // Log embedded animations
        if (gltf.animations && gltf.animations.length > 0) {
            console.log('RPM + Three.js Demo: Embedded animations in avatar GLB:');
            gltf.animations.forEach(anim => console.log(`  - ${anim.name}`));
        } else {
            console.log('RPM + Three.js Demo: No embedded animations found in avatar GLB.');
        }

        const box = new THREE.Box3().setFromObject(currentAvatarScene);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        currentAvatarScene.position.set(-center.x, -box.min.y, -center.z);
        console.log('RPM + Three.js Demo: Avatar centered and placed on ground.');
        controls.target.set(0, size.y / 2, 0);
        camera.position.set(0, size.y / 1.8, size.y * 1.3);
        camera.lookAt(0, size.y / 2, 0);
        controls.update();
        if (externalAnimationsLoaded) {
            setupAnimationDropdown(); // Renamed call
        } else {
            console.log('RPM + Three.js Demo: Waiting for external animations to load before setting up dropdown.');
        }
        loadingText.style.display = 'none';
        sceneContainer.style.display = 'block';
        console.log('RPM + Three.js Demo: Avatar successfully loaded and displayed');
    } catch (error) {
        console.error('RPM + Three.js Demo: Error loading avatar:', error);
        loadingText.textContent = 'Error loading avatar. Check console for details.';
        loadingText.style.display = 'block';
        sceneContainer.style.display = 'none';
    }
}

function openAvatarCreator() {
    console.log('RPM + Three.js Demo: Opening Ready Player Me avatar creator');
    frame.src = `https://${subdomain}.readyplayer.me/avatar?frameApi`;
    frame.style.display = 'block';
    container.style.display = 'none';
}

function subscribe(event) {
    const json = parse(event);
    if (json?.source !== 'readyplayerme') {
        return;
    }

    // Susbribe to all events sent from Ready Player Me since this app is showcasing items url
    if (json.eventName === 'v1.frame.ready') {
        frame.contentWindow.postMessage(
            JSON.stringify({
                target: 'readyplayerme',
                type: 'subscribe',
                eventName: 'v1.**'
            }),
            '*'
        );
    }

    // Get avatar GLB URL
    if (json.eventName === 'v1.avatar.exported') {
        console.log(`RPM + Three.js Demo: Avatar URL received: ${json.data.url}`);
        frame.style.display = 'none';
        container.style.display = 'none';
        sceneContainer.style.display = 'block';
        if (!scene) initScene();
        loadAvatar(json.data.url);
    }

    // Get user id
    if (json.eventName === 'v1.user.set') {
        console.log(`RPM + Three.js Demo: User with id ${json.data.id} set`);
    }
}

function parse(event) {
    try {
        return JSON.parse(event.data);
    } catch (error) {
        return null;
    }
}

function clearInstantiatedAvatars() {
    instantiatedAvatars.forEach(avatar => {
        scene.remove(avatar.model);
    });
    instantiatedAvatars = [];
    if (currentAvatarScene) {
        currentAvatarScene.visible = true;
    }
}

function instantiateCharacters(count) {
    clearInstantiatedAvatars();
    if (!currentAvatarScene) {
        console.warn('RPM + Three.js Demo: No base avatar to instantiate.');
        return;
    }

    if (isNaN(count) || count <= 0) {
        console.warn('RPM + Three.js Demo: Invalid character count.');
        return;
    }

    console.log(`RPM + Three.js Demo: Instantiating ${count} characters.`);

    const gridDim = Math.ceil(Math.sqrt(count));
    const spacing = 2.0; 

    for (let i = 0; i < count; i++) {
        const model = SkeletonUtils.clone(currentAvatarScene);
        const mixer = new THREE.AnimationMixer(model);

        const x = (i % gridDim) - (gridDim - 1) / 2;
        const z = Math.floor(i / gridDim) - (gridDim - 1) / 2;

        model.position.set(x * spacing, 0, z * spacing);
        
        scene.add(model);
        instantiatedAvatars.push({ model, mixer });
    }
    
    // Hide original avatar to only show the grid
    currentAvatarScene.visible = false;
}

function updateStats() {
    const statsDiv = document.getElementById('render-stats');
    if (!statsDiv) return;

    const now = performance.now();
    stats.frames++;

    const delta = now - stats.lastTime;
    if (delta >= 1000) {
        const fps = Math.round((stats.frames * 1000) / delta);
        stats.fps = fps;
        stats.lastTime = now;
        stats.frames = 0;

        // If a benchmark is running, record stats
        if (currentRunStats) {
            currentRunStats.minFps = Math.min(currentRunStats.minFps, fps);
            currentRunStats.maxFps = Math.max(currentRunStats.maxFps, fps);
            currentRunStats.totalFps += fps;
            currentRunStats.frameCount++; // Count how many seconds have passed
        }
    }

    if (renderer) {
        const info = renderer.info.render;
        statsDiv.textContent =
            `FPS: ${stats.fps}\n` +
            `Draw Calls: ${info.calls}\n` +
            `Triangles: ${info.triangles}`;
    }
}

async function runBenchmarkSuite() {
    if (isSuiteRunning) return;
    isSuiteRunning = true;
    suiteResults = [];
    runSuiteButton.disabled = true;
    instantiateButton.disabled = true;
    reportDisplay.style.display = 'block';
    reportDisplay.innerHTML = '<h3>Running Benchmark Suite...</h3>';

    for (const benchmark of benchmarkConfig) {
        reportDisplay.innerHTML += `<p>Running test: ${benchmark.name}...</p>`;

        if (benchmark.CharacterID && benchmark.CharacterID !== 'default') {
            reportDisplay.innerHTML += `<p>Loading character: ${benchmark.CharacterID}...</p>`;
            await loadAvatar(benchmark.CharacterID);
        } else if (!currentAvatarScene) {
            reportDisplay.innerHTML += `<p style="color: red;">Error: No default character loaded and no CharacterID specified in benchmark "${benchmark.name}". Skipping.</p>`;
            suiteResults.push({ name: benchmark.name, error: "No character available." });
            continue; // Skip this test
        }
        
        const result = await runSingleBenchmark(benchmark);
        suiteResults.push(result);
        reportDisplay.innerHTML += `<p>Done.</p>`;
    }

    displayBenchmarkReport();
    isSuiteRunning = false;
    runSuiteButton.disabled = false;
    instantiateButton.disabled = false;
}

function runSingleBenchmark(benchmark) {
    return new Promise(resolve => {
        instantiateCharacters(benchmark.count);

        // Make sure there's an animation to play
        if (!externalAnimationClips || externalAnimationClips.length === 0) {
            console.error("No animations loaded for benchmark.");
            resolve({ name: benchmark.name, error: "No animations loaded." });
            return;
        }
        playAnimation(externalAnimationClips[0]);

        currentRunStats = {
            startTime: performance.now(),
            frames: 0,
            totalFps: 0,
            minFps: Infinity,
            maxFps: -Infinity,
            frameCount: 0,
        };

        setTimeout(() => {
            const avgFps = currentRunStats.frameCount > 0 ? Math.round(currentRunStats.totalFps / currentRunStats.frameCount) : 0;
            let memory = 'N/A';
            if (performance.memory) {
                memory = `${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB`;
            }

            const result = {
                name: benchmark.name,
                count: benchmark.count,
                minFps: currentRunStats.minFps,
                maxFps: currentRunStats.maxFps,
                avgFps,
                memory,
            };

            currentRunStats = null; // Stop recording
            clearInstantiatedAvatars();
            resolve(result);

        }, benchmark.duration);
    });
}

function displayBenchmarkReport() {
    let reportHTML = '<h3>Benchmark Report</h3>';
    reportHTML += '<table>';
    reportHTML += '<tr><th>Test Name</th><th>Characters</th><th>Min FPS</th><th>Max FPS</th><th>Avg FPS</th><th>Memory</th></tr>';
    for (const result of suiteResults) {
         if(result.error) {
            reportHTML += `<tr><td>${result.name}</td><td colspan="5" style="color: red;">${result.error}</td></tr>`;
        } else {
            reportHTML += `<tr><td>${result.name}</td><td>${result.count}</td><td>${result.minFps}</td><td>${result.maxFps}</td><td>${result.avgFps}</td><td>${result.memory}</td></tr>`;
        }
    }
    reportHTML += '</table>';
    reportDisplay.innerHTML = reportHTML;
}

initScene();
loadExternalAnimations();
loadBenchmarkConfig();
createButton.addEventListener('click', openAvatarCreator);
window.addEventListener('message', subscribe);
instantiateButton.addEventListener('click', () => {
    const count = parseInt(characterCountInput.value, 10);
    instantiateCharacters(count);
});
runSuiteButton.addEventListener('click', runBenchmarkSuite); 