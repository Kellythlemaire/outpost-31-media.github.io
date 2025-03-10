import { ARButton } from './lib/ARButton.js';
import {
  makeGltfMask,
  loadGltf,
  getImageBitmap,
  getPointInBetweenByPerc,
  rotateAroundPoint
} from './utils.js'
let desktopTesting = true;
let physicsDebug = false;
const {
  AmmoPhysics,
  PhysicsLoader
} = ENABLE3D;
let container;

const STATE = {
  DISABLE_DEACTIVATION: 4
};
let rigidBodies = [],
  tmpTrans,
  directionalLight;
let clock = new THREE.Clock();
let forest;
let origin = [0, -1.8, -1];
let iterateTime = Infinity;
let iterateStep = 2000;
let time;

// Initializing Variables
let camera, scene, renderer, physics, deltaTime;
let model;
let controller;
let reticle;
let loader;
let gltf;
let mixer;
let plane;
let timeout;
let terrainScene, decoScene;
let placedTerrain = false;
let spotLight;
let waterPlane;

let waterParticles = [];

// Bounding boxes Variables
let modelBB, wallBBFront, wallBBLeft, wallBBRight, wallBBGround, wallBBCeiling, wallBBBack, waterBB;

// Gui Variables
let speed = 0.1 * 0.001;


/*****************************************Build Forest, Forest has many Trees**********************************/

class Forest {
  constructor(height, width, scene, orgin, terrain) {
    this.terrain = terrain;
    this.height = height;
    this.width = width;
    this.scene = scene;
    this.radius = [this.height / 2, this.width / 2];
    this.orgin = orgin;
    this.mixers = [];
    this.init();
  }
  async init() {
    this.models = await this.loadModels();
    console.log(this.models);
    this.trees = [];
    forestCallback();
  }
  async loadModels() {
    const loader = new THREE.GLTFLoader();
    // return {
    //     green: await loader.loadAsync('./gltf/greentree.glb'),
    //     burning: await loader.loadAsync('./gltf/burningtree.glb'),
    //     burnt: await loader.loadAsync('./gltf/burnttree.glb')
    // }
    return await loader.loadAsync('./gltf/tree3.glb')

  }

  scatterTrees(geometry, options) {
    if (!options.scene) {
      options.scene = new THREE.Object3D();
    }
    var defaultOptions = {
      spread: 0.025,
      smoothSpread: 0,
      sizeVariance: 0.1,
      randomness: Math.random,
      maxSlope: 0.6283185307179586, // 36deg or 36 / 180 * Math.PI, about the angle of repose of earth
      maxTilt: Infinity,
      w: 0,
      h: 0,
    };
    for (var opt in defaultOptions) {
      if (defaultOptions.hasOwnProperty(opt)) {
        options[opt] = typeof options[opt] === 'undefined' ? defaultOptions[opt] : options[opt];
      }
    }

    var spreadIsNumber = typeof options.spread === 'number',
      randomHeightmap,
      randomness,
      spreadRange = 1 / options.smoothSpread,
      doubleSizeVariance = options.sizeVariance * 2,
      vertex1 = new THREE.Vector3(),
      vertex2 = new THREE.Vector3(),
      vertex3 = new THREE.Vector3(),
      faceNormal = new THREE.Vector3(),
      up = new THREE.Vector3(0, 1, 0).clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.5 * Math.PI);
    if (spreadIsNumber) {
      randomHeightmap = options.randomness();
      randomness = typeof randomHeightmap === 'number' ? Math.random : function (k) { return randomHeightmap[k]; };
    }

    geometry = geometry.toNonIndexed();
    var gArray = geometry.attributes.position.array;
    for (var i = 0; i < geometry.attributes.position.array.length; i += 9) {
      vertex1.set(gArray[i + 0], gArray[i + 1], gArray[i + 2]);
      vertex2.set(gArray[i + 3], gArray[i + 4], gArray[i + 5]);
      vertex3.set(gArray[i + 6], gArray[i + 7], gArray[i + 8]);
      THREE.Triangle.getNormal(vertex1, vertex2, vertex3, faceNormal);

      var place = false;
      if (spreadIsNumber) {
        var rv = randomness(i / 9);
        if (rv < options.spread) {
          place = true;
        }
        else if (rv < options.spread + options.smoothSpread) {
          // Interpolate rv between spread and spread + smoothSpread,
          // then multiply that "easing" value by the probability
          // that a mesh would get placed on a given face.
          place = THREE.Terrain.EaseInOut((rv - options.spread) * spreadRange) * options.spread > Math.random();
        }
      }
      else {
        place = options.spread(vertex1, i / 9, faceNormal, i);
      }
      if (place) {
        // Don't place a mesh if the angle is too steep.
        if (faceNormal.angleTo(up) > options.maxSlope) {
          continue;
        }
        if (new THREE.Vector3(0, 0, 0).addVectors(vertex1, vertex2).add(vertex3).divideScalar(3).z < .4) {
          continue;
        }
        var tree = new Tree(this.models);
        this.trees.push(tree);
        this.mixers.push(tree.mixer);
        var mesh = tree.object3D;
        mesh.position.addVectors(vertex1, vertex2).add(vertex3).divideScalar(3);
        if (options.maxTilt > 0) {
          var normal = mesh.position.clone().add(faceNormal);
          mesh.lookAt(normal);
          var tiltAngle = faceNormal.angleTo(up);
          if (tiltAngle > options.maxTilt) {
            var ratio = options.maxTilt / tiltAngle;
            mesh.rotation.x *= ratio;
            mesh.rotation.y *= ratio;
            mesh.rotation.z *= ratio;
          }
        }
        mesh.rotation.x += 90 / 180 * Math.PI;
        mesh.rotateY(Math.random() * 2 * Math.PI);
        if (options.sizeVariance) {
          var variance = Math.random() * doubleSizeVariance - options.sizeVariance;
          mesh.scale.x = mesh.scale.z = 1 + variance;
          mesh.scale.y += variance;
        }

        mesh.updateMatrix();
        options.scene.add(mesh);
      }
    }

    return [options.scene, geometry];
  }

  iterateFire() {
    const lastBurn = this.getTreesByState(1);
    // console.log(`${lastBurn.length} trees burning`)
    const treesToLight = [];
    lastBurn.forEach(burningTree => {
      this.getNeibours(burningTree, .1).forEach(treeToLight => {
        const randomFac = Math.random();
        if (randomFac <= .33) {
          treeToLight.light();
        } else if (randomFac >= .66) {
          treeToLight.light();
          this.getNeibours(treeToLight, .12).forEach(anotherTreeToLight => {
            const newRandomFac = Math.random();
            if (newRandomFac <= .5) {
              anotherTreeToLight.light();
            };
          });
        };

      });
      burningTree.burnOut();
    });

  }
  getNeibours(tree, maxDistance) {
    const neiTrees = [];
    const treePos = tree.object3D.position;
    this.trees.forEach(compTree => {
      if (treePos.distanceTo(compTree.object3D.position) < maxDistance) {
        neiTrees.push(compTree);
      }
    })

    return neiTrees;
  }
  getTreesByState(state) {
    let treesByState = [];
    this.trees.forEach(tree => {
      if (tree.state == state) {
        treesByState.push(tree);
      }
    });
    return treesByState;
  }
  findTree(cor) {
    // console.log(`finding tree ${cor}`)
    return this.trees[cor[0]][cor[1]];
  }
}

class Tree {
  constructor(models) {

    // this.cor = cor;
    this.state = 0;
    this.models = models;
    this.timeBurning = 0;
    this.wetness = 0;
    this.maxBurnTime = Math.floor(Math.random() * (6 - 3)) + 3;
    this.object3D = this.build();
  }
  build() {
    this.model = this.models.scene.clone();
    this.animations = this.models.animations;
    this.mixer = new THREE.AnimationMixer(this.model);
    // this.pos = [this.cor[0],this.cor[1],this.cor[2]];
    const clone = this.model;
    // clone.rotation.y = ((Math.floor(Math.random() * (1 - 3)) + 1) * 90) * (Math.PI / 180.0);
    // this.scene.add(clone);
    clone.getObjectByName('deadTree').visible = false;
    clone.getObjectByName('fire').visible = false;
    // clone.position.set(this.pos[0], this.pos[1], this.pos[2]);
    // console.log(`pos ${pos}`) //this assumes that all tiles for forest fire are square
    clone.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        node.receiveShadow = true;
        if (node.material.map) node.material.map.anisotropy = 16;
      }
    });
    return clone;
  }
  light() {
    if (this.state == 0 && this.wetness == 0) {
      const fireAnim = this.mixer.clipAction(this.animations[0]);
      fireAnim.play();
      this.state = 1;
      this.object3D.getObjectByName('deadTree').visible = true;
      this.object3D.getObjectByName('fire').visible = true;
      this.object3D.getObjectByName('greenTree').visible = false;
      this.timeBurning = 1;
      // console.log(`tree ${this.cor} lit`)
    } else if (this.state == 0 && this.wetness != 0) {
      this.wetness -= 1;
    };

  }
  burnOut() {
    if (this.timeBurning >= this.maxBurnTime) {
      this.state = 2;
      this.object3D.getObjectByName('fire').visible = false;
    } else {
      this.timeBurning += 1;
    }

  }
  water() {
    if (this.state == 1) {
      this.state = 2;
      this.object3D.getObjectByName('fire').visible = false;
    } else if (this.state == 0 && this.wetness < 3) {
      this.wetness += 1;
    }

  }

}

/**************************************************************************************************************/

const Start = () => {
  init();
  setupPhysicsWorld();
  animate();
};

async function init() {
  const container = document.createElement('div');
  document.body.appendChild(container);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 40);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ReinhardToneMapping;
  renderer.toneMappingExposure = 1.5;
  renderer.toneMappingWhitePoint = 1.0;
  renderer.physicallyCorrectLights = true;
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  addLightToScene();
  addShadowPlaneToScene();

  controller = renderer.xr.getController(0);
  controller.addEventListener("select", onSelect);
  scene.add(controller);

  // adding the reticle to the scene
  addSquareReticleToScene();

  // loading the model 
  await loadModel();
  mixer = new THREE.AnimationMixer(model);
  let propellerLeft = mixer.clipAction(gltf.animations[12]);
  let propellerRight = mixer.clipAction(gltf.animations[13]);
  propellerLeft.play();
  propellerRight.play();

  // Add the AR button to the body of the DOM
  const button = ARButton.createButton(renderer, {
    optionalFeatures: ["dom-overlay", 'light-estimation'],
    domOverlay: { root: document.body },
    requiredFeatures: ["hit-test"],
  });
  document.body.appendChild(button);
  renderer.domElement.style.display = "none";

  button.addEventListener("click", () => {
    document.getElementById("welcome").style.display = 'none';
    document.getElementById("instructions").textContent = "Find an open area. Look around the room to calibrate the space. Tap your screen once a reticle appears on the ground to place the terrain."
  });

  // handler if throttle is changed
  let slider = document.getElementById("throttleSlider");
  slider.oninput = function () {
    speed = this.value;
  }

  if (desktopTesting === true) {
    // handlers if directional buttons are pushed
    document.querySelector("#up").addEventListener("mousedown", () => {
      timeout = setTimeout(moveUp, 100);

      let backRightDown = mixer.clipAction(gltf.animations[14]);
      backRightDown.clampWhenFinished = true;
      backRightDown.timeScale = 4;
      backRightDown.setLoop(THREE.LoopOnce);
      backRightDown.play();

      let backLeftDown = mixer.clipAction(gltf.animations[18]);
      backLeftDown.clampWhenFinished = true;
      backLeftDown.timeScale = 4;
      backLeftDown.setLoop(THREE.LoopOnce);
      backLeftDown.play();

    });
    document.querySelector("#down").addEventListener("mousedown", () => {
      timeout = setTimeout(moveDown, 100);

      let backRightUp = mixer.clipAction(gltf.animations[16]);
      backRightUp.clampWhenFinished = true;
      backRightUp.timeScale = 4;
      backRightUp.setLoop(THREE.LoopOnce);
      backRightUp.play();

      let backLeftUp = mixer.clipAction(gltf.animations[20]);
      backLeftUp.clampWhenFinished = true;
      backLeftUp.timeScale = 4;
      backLeftUp.setLoop(THREE.LoopOnce);
      backLeftUp.play();

    });
    document.querySelector("#left").addEventListener("mousedown", () => {
      timeout = setTimeout(moveLeft, 100);

      let frontRightUp = mixer.clipAction(gltf.animations[2]);
      frontRightUp.clampWhenFinished = true;
      frontRightUp.timeScale = 4;
      frontRightUp.setLoop(THREE.LoopOnce);
      frontRightUp.play();

      let frontLeftDown = mixer.clipAction(gltf.animations[4]);
      frontLeftDown.clampWhenFinished = true;
      frontLeftDown.timeScale = 4;
      frontLeftDown.setLoop(THREE.LoopOnce);
      frontLeftDown.play();

      let backWingLeft = mixer.clipAction(gltf.animations[8]);
      backWingLeft.clampWhenFinished = true;
      backWingLeft.timeScale = 4;
      backWingLeft.setLoop(THREE.LoopOnce);
      backWingLeft.play();

    });
    document.querySelector("#right").addEventListener("mousedown", () => {
      timeout = setTimeout(moveRight, 100);

      let frontRightDown = mixer.clipAction(gltf.animations[0]);
      frontRightDown.clampWhenFinished = true;
      frontRightDown.timeScale = 4;
      frontRightDown.setLoop(THREE.LoopOnce);
      frontRightDown.play();

      let frontLeftUp = mixer.clipAction(gltf.animations[6]);
      frontLeftUp.clampWhenFinished = true;
      frontLeftUp.timeScale = 4;
      frontLeftUp.setLoop(THREE.LoopOnce);
      frontLeftUp.play();

      let backWingRight = mixer.clipAction(gltf.animations[10]);
      backWingRight.clampWhenFinished = true;
      backWingRight.timeScale = 4;
      backWingRight.setLoop(THREE.LoopOnce);
      backWingRight.play();
    });

    // handlers if directional buttons are released
    document.querySelector("#up").addEventListener("mouseup", () => {
      clearTimeout(timeout);
      straightenUp();

      let backRightDownReturn = mixer.clipAction(gltf.animations[15]);
      backRightDownReturn.clampWhenFinished = true;
      backRightDownReturn.timeScale = 4;
      backRightDownReturn.setLoop(THREE.LoopOnce);
      backRightDownReturn.play();

      let backLeftDownReturn = mixer.clipAction(gltf.animations[19]);
      backLeftDownReturn.clampWhenFinished = true;
      backLeftDownReturn.timeScale = 4;
      backLeftDownReturn.setLoop(THREE.LoopOnce);
      backLeftDownReturn.play();
    });
    document.querySelector("#down").addEventListener("mouseup", () => {
      clearTimeout(timeout);
      straightenDown();

      let backRightUpReturn = mixer.clipAction(gltf.animations[17]);
      backRightUpReturn.clampWhenFinished = true;
      backRightUpReturn.timeScale = 4;
      backRightUpReturn.setLoop(THREE.LoopOnce);
      backRightUpReturn.play();

      let backLeftUpReturn = mixer.clipAction(gltf.animations[21]);
      backLeftUpReturn.clampWhenFinished = true;
      backLeftUpReturn.timeScale = 4;
      backLeftUpReturn.setLoop(THREE.LoopOnce);
      backLeftUpReturn.play();
    });
    document.querySelector("#left").addEventListener("mouseup", () => {
      clearTimeout(timeout);
      straightenLeft();

      let frontRightUpReturn = mixer.clipAction(gltf.animations[3]);
      frontRightUpReturn.clampWhenFinished = true;
      frontRightUpReturn.timeScale = 4;
      frontRightUpReturn.setLoop(THREE.LoopOnce);
      frontRightUpReturn.play();

      let frontLeftDownReturn = mixer.clipAction(gltf.animations[5]);
      frontLeftDownReturn.clampWhenFinished = true;
      frontLeftDownReturn.timeScale = 4;
      frontLeftDownReturn.setLoop(THREE.LoopOnce);
      frontLeftDownReturn.play();

      let backWingLeftReturn = mixer.clipAction(gltf.animations[9]);
      backWingLeftReturn.clampWhenFinished = true;
      backWingLeftReturn.timeScale = 4;
      backWingLeftReturn.setLoop(THREE.LoopOnce);
      backWingLeftReturn.play();

    });
    document.querySelector("#right").addEventListener("mouseup", () => {
      clearTimeout(timeout);
      straightenRight();

      let frontRightDownReturn = mixer.clipAction(gltf.animations[1]);
      frontRightDownReturn.clampWhenFinished = true;
      frontRightDownReturn.timeScale = 4;
      frontRightDownReturn.setLoop(THREE.LoopOnce);
      frontRightDownReturn.play();

      let frontLeftUpReturn = mixer.clipAction(gltf.animations[7]);
      frontLeftUpReturn.clampWhenFinished = true;
      frontLeftUpReturn.timeScale = 4;
      frontLeftUpReturn.setLoop(THREE.LoopOnce);
      frontLeftUpReturn.play();

      let backWingRightReturn = mixer.clipAction(gltf.animations[11]);
      backWingRightReturn.clampWhenFinished = true;
      backWingRightReturn.timeScale = 4;
      backWingRightReturn.setLoop(THREE.LoopOnce);
      backWingRightReturn.play();
    });
  } else {
    // handlers if directional buttons are pushed
    document.querySelector("#up").addEventListener("touchstart", () => {
      timeout = setTimeout(moveUp, 100);

      let backRightDown = mixer.clipAction(gltf.animations[14]);
      backRightDown.clampWhenFinished = true;
      backRightDown.timeScale = 4;
      backRightDown.setLoop(THREE.LoopOnce);
      backRightDown.play();

      let backLeftDown = mixer.clipAction(gltf.animations[18]);
      backLeftDown.clampWhenFinished = true;
      backLeftDown.timeScale = 4;
      backLeftDown.setLoop(THREE.LoopOnce);
      backLeftDown.play();
    });
    document.querySelector("#down").addEventListener("touchstart", () => {
      timeout = setTimeout(moveDown, 100);

      let backRightUp = mixer.clipAction(gltf.animations[16]);
      backRightUp.clampWhenFinished = true;
      backRightUp.timeScale = 4;
      backRightUpn.setLoop(THREE.LoopOnce);
      backRightUp.play();

      let backLeftUp = mixer.clipAction(gltf.animations[20]);
      backLeftUp.clampWhenFinished = true;
      backLeftUp.timeScale = 4;
      backLeftUp.setLoop(THREE.LoopOnce);
      backLeftUp.play();
    });
    document.querySelector("#left").addEventListener("touchstart", () => {
      timeout = setTimeout(moveLeft, 100);

      let frontRightUp = mixer.clipAction(gltf.animations[2]);
      frontRightUp.clampWhenFinished = true;
      frontRightUp.timeScale = 4;
      frontRightUp.setLoop(THREE.LoopOnce);
      frontRightUp.play();

      let frontLeftDown = mixer.clipAction(gltf.animations[4]);
      frontLeftDown.clampWhenFinished = true;
      frontLeftDown.timeScale = 4;
      frontLeftDown.setLoop(THREE.LoopOnce);
      frontLeftDown.play();

      let backWingLeft = mixer.clipAction(gltf.animations[8]);
      backWingLeft.clampWhenFinished = true;
      backWingLeft.timeScale = 4;
      backWingLeft.setLoop(THREE.LoopOnce);
      backWingLeft.play();
    });
    document.querySelector("#right").addEventListener("touchstart", () => {
      timeout = setTimeout(moveRight, 100);

      let frontRightDown = mixer.clipAction(gltf.animations[0]);
      frontRightDown.clampWhenFinished = true;
      frontRightDown.timeScale = 4;
      frontRightDown.setLoop(THREE.LoopOnce);
      frontRightDown.play();

      let frontLeftUp = mixer.clipAction(gltf.animations[6]);
      frontLeftUp.clampWhenFinished = true;
      frontLeftUp.timeScale = 4;
      frontLeftUp.setLoop(THREE.LoopOnce);
      frontLeftUp.play();

      let backWingRight = mixer.clipAction(gltf.animations[10]);
      backWingRight.clampWhenFinished = true;
      backWingRight.timeScale = 4;
      backWingRight.setLoop(THREE.LoopOnce);
      backWingRight.play();
    });

    // handlers if directional buttons are released
    document.querySelector("#up").addEventListener("touchend", () => {
      clearTimeout(timeout);
      straightenUp();

      let backRightDownReturn = mixer.clipAction(gltf.animations[15]);
      backRightDownReturn.clampWhenFinished = true;
      backRightDownReturn.timeScale = 4;
      backRightDownReturn.setLoop(THREE.LoopOnce);
      backRightDownReturn.play();

      let backLeftDownReturn = mixer.clipAction(gltf.animations[19]);
      backLeftDownReturn.clampWhenFinished = true;
      backLeftDownReturn.timeScale = 4;
      backLeftDownReturn.setLoop(THREE.LoopOnce);
      backLeftDownReturn.play();
    });
    document.querySelector("#down").addEventListener("touchend", () => {
      clearTimeout(timeout);
      straightenDown();

      let backRightUpReturn = mixer.clipAction(gltf.animations[17]);
      backRightUpReturn.clampWhenFinished = true;
      backRightUpReturn.timeScale = 4;
      backRightUpReturn.setLoop(THREE.LoopOnce);
      backRightUpReturn.play();

      let backLeftUpReturn = mixer.clipAction(gltf.animations[21]);
      backLeftUpReturn.clampWhenFinished = true;
      backLeftUpReturn.timeScale = 4;
      backLeftUpReturn.setLoop(THREE.LoopOnce);
      backLeftUpReturn.play();

    });
    document.querySelector("#left").addEventListener("touchend", () => {
      clearTimeout(timeout);
      straightenLeft();

      let frontRightUpReturn = mixer.clipAction(gltf.animations[3]);
      frontRightUpReturn.clampWhenFinished = true;
      frontRightUpReturn.timeScale = 4;
      frontRightUpReturn.setLoop(THREE.LoopOnce);
      frontRightUpReturn.play();

      let frontLeftDownReturn = mixer.clipAction(gltf.animations[5]);
      frontLeftDownReturn.clampWhenFinished = true;
      frontLeftDownReturn.timeScale = 4;
      frontLeftDownReturn.setLoop(THREE.LoopOnce);
      frontLeftDownReturn.play();

      let backWingLeftReturn = mixer.clipAction(gltf.animations[9]);
      backWingLeftReturn.clampWhenFinished = true;
      backWingLeftReturn.timeScale = 4;
      backWingLeftReturn.setLoop(THREE.LoopOnce);
      backWingLeftReturn.play();
    });
    document.querySelector("#right").addEventListener("touchend", () => {
      clearTimeout(timeout);
      straightenRight();

      let frontRightDownReturn = mixer.clipAction(gltf.animations[1]);
      frontRightDownReturn.clampWhenFinished = true;
      frontRightDownReturn.timeScale = 4;
      frontRightDownReturn.setLoop(THREE.LoopOnce);
      frontRightDownReturn.play();

      let frontLeftUpReturn = mixer.clipAction(gltf.animations[7]);
      frontLeftUpReturn.clampWhenFinished = true;
      frontLeftUpReturn.timeScale = 4;
      frontLeftUpReturn.setLoop(THREE.LoopOnce);
      frontLeftUpReturn.play();

      let backWingRightReturn = mixer.clipAction(gltf.animations[11]);
      backWingRightReturn.clampWhenFinished = true;
      backWingRightReturn.timeScale = 4;
      backWingRightReturn.setLoop(THREE.LoopOnce);
      backWingRightReturn.play();
    });

  }

  document.querySelector("#water").addEventListener("click", dropWater);

  window.addEventListener("resize", onWindowResize, false);

}

/***************************************Initializing Items In Scene*********************************************/

/*
  Function: addLightToScene
  Description: 
    Creates a hemisphere light and adds it to the scene. 
    Creates a spot light that casts shadows and adds it to the scene
  Parameters: None
*/
function addLightToScene() {

  // creating hemisphere light
  var light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, .7);
  light.position.set(0.5, 1, 0.25);
  scene.add(light);

  // creating a spotlight that casts shadows
  spotLight = new THREE.SpotLight(0xffa95c, 4);
  spotLight.castShadow = true;
  spotLight.shadow.bias = -0.0001;
  spotLight.shadow.mapSize.width = 1024 * 4;
  spotLight.shadow.mapSize.height = 1024 * 4;
  scene.add(spotLight);
}

/*
  Function: addShadowPlaneToScene
  Description: 
    Creates a plane that recieves shadows and adds it to the scene
  Parameters: None
*/
function addShadowPlaneToScene() {
  const geometry = new THREE.PlaneGeometry(1000, 1000);
  const material = new THREE.ShadowMaterial();
  material.opacity = 0.5;

  plane = new THREE.Mesh(geometry, material);
  plane.receiveShadow = true;
  plane.visible = false;
  plane.rotateX(-Math.PI / 2);
  plane.matrixAutoUpdate = false;
  scene.add(plane);
}

/*
  Function addReticleToScene
  Description: 
    Creates a square reticle to represent the terrain. 
  Paramaters: None
*/
function addSquareReticleToScene() {
  const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial();

  reticle = new THREE.Mesh(geometry, material);

  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
}

/*
  Function: loadModel
  Description: 
    Loads the model. 
    Ensures that each node casts a shadow
  Parameters: None
*/
async function loadModel() {
  loader = new THREE.GLTFLoader();
  gltf = await loader.loadAsync("./gltf/a52.glb");
  model = gltf.scene;
  model.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
      if (node.material.map) node.material.map.anisotropy = 16;
    }
  });
  model.scale.set(0.025, 0.025, 0.025);
  model.visible = false;
}

/****************************************Functions Called with onSelect*********************************************/

/*
  Function: onSelect
  Description: 
    Runs when the screen is tapped. 
    If the reticle is not visible or the model is visible, function will return. 
    If the model is not visible and placedTerrain is false, the terrain will be placed at the location of the reticle, the reticle will change to a circle,
    out of bounds bounding boxes will be built, and the trees will be set to have shadows. 
    If the terrain has been placed and the model is not visible, the directional buttons will be displayed. the model will be placed and the reticle will be removed from the scene. 
  Parameters: None
*/
function onSelect() {

  // returns null if the reticle is not visible
  if (!reticle.visible || model.visible) {
    return;

  } else if (!model.visible && placedTerrain === false) {

    let reticlePosition = new THREE.Vector3();
    reticlePosition.setFromMatrixPosition(reticle.matrixWorld);
    let x = reticlePosition.x;
    let y = reticlePosition.y;
    let z = reticlePosition.z;;

    origin = [x, y, z];

    buildForest();

    addCircleReticleToScene();

    addWallBoundingBoxes(x, y, z);

    addCloudsToScene(x, y, z);

    document.getElementById("instructions").textContent = "Take a couple of steps away fromt terrain. Tap the screen when a circle reticle appears to place the plane."

    placedTerrain = true;

  } else if (!model.visible && placedTerrain === true) {
    startBurning();
    // placing the model at the location of the reticle
    model.position.setFromMatrixPosition(reticle.matrix);
    model.quaternion.setFromRotationMatrix(reticle.matrix);
    model.rotation.y = Math.PI;
    model.visible = true;
    scene.add(model);

    // directional buttons become visible
    document.querySelector("#up").style.display = "block";
    document.querySelector("#down").style.display = "block";
    document.querySelector("#left").style.display = "block";
    document.querySelector("#right").style.display = "block";
    document.querySelector("#water").style.display = "block";

    // reticle is removed from the scene
    reticle.visible = false;
    scene.remove(reticle);

    addModelBoundingBox();

    document.getElementById("instructions").textContent = "Press the directional buttons at the bottom of the screen to fly the plane and the throttle to control the speed of the plane."

    setTimeout(removeInstructions, 15000);
  }
}

/*
  Function: addCircleReticleToScene
  Description: 
    Changes the reticle from a plane to a circle. 
  Parameters: None
*/
function addCircleReticleToScene() {
  scene.remove(reticle);
  const geometry = new THREE.RingBufferGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial();
  reticle = new THREE.Mesh(geometry, material);

  reticle.matrixAutoUpdate = false;
  reticle.visible = false; // we start with the reticle not visible
  scene.add(reticle);
}

/*
  Function: addWallBoundingBoxes
  Description: 
    Called from onSelect. 
    Creates bounding boxes for the out of bound areas. 
  Parameters: 
    - x: the x coordinate of the reticle when onSelect is called
    - y: the y coordinate of the reticle when onSelect is called
    - z: the z coordinate of the reticle when onSelect is called
*/
function addWallBoundingBoxes(x, y, z) {
  wallBBFront = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
  const meshFront = new THREE.Mesh(new THREE.BoxGeometry(40, 40, 0.25), new THREE.MeshBasicMaterial());
  meshFront.position.set(x, y, z - 15);
  //scene.add(meshFront); 
  wallBBFront.setFromObject(meshFront);

  wallBBBack = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
  const meshBack = new THREE.Mesh(new THREE.BoxGeometry(40, 40, 0.25), new THREE.MeshBasicMaterial());
  meshBack.position.set(x, y, z + 15);
  //scene.add(meshBack); 
  wallBBBack.setFromObject(meshBack);

  wallBBLeft = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
  const meshLeft = new THREE.Mesh(new THREE.BoxGeometry(40, 40, 0.25), new THREE.MeshBasicMaterial());
  meshLeft.position.set(x - 15, y, x);
  meshLeft.rotation.y = Math.PI / 2;
  //scene.add(meshLeft); 
  wallBBLeft.setFromObject(meshLeft);

  wallBBRight = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
  const meshRight = new THREE.Mesh(new THREE.BoxGeometry(40, 40, 0.25), new THREE.MeshBasicMaterial());
  meshRight.position.set(x + 15, 0, 0);
  meshRight.rotation.y = Math.PI / 2;
  //scene.add(meshRight); 
  wallBBRight.setFromObject(meshRight);

  wallBBGround = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
  const meshGround = new THREE.Mesh(new THREE.BoxGeometry(40, 40, 0.25), new THREE.MeshBasicMaterial());
  meshGround.position.set(x, -1.8, z);
  meshGround.rotation.x = Math.PI / 2;
  //scene.add(meshGround); 
  wallBBGround.setFromObject(meshGround);

  wallBBCeiling = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
  const meshCeiling = new THREE.Mesh(new THREE.BoxGeometry(40, 40, 0.25), new THREE.MeshBasicMaterial());
  meshCeiling.position.set(x, y + 20, z);
  meshCeiling.rotation.x = Math.PI / 2;
  //scene.add(meshCeiling); 
  wallBBCeiling.setFromObject(meshCeiling);

}

/*
  Function: randomNumber
  Description: 
    Returns a random number between the given min and max values. 
  Parameters
    - min: a float that represents the minimum value
    - max: a float that represents the maximum value
*/
function randomNumber(min, max) {
  return (Math.random() * (max - min) + min);
}

/*
  Function: addCloudsToScene
  Description: 
    Adds 4 clouds to the scene in a random position and rotation. 
  Parameters: 
    - x: the x coordinate of the origin of the terrain
    - y: the y coordinate of the origin of the terrain
    - z: the z coordinate of the origin of the terrain
*/
async function addCloudsToScene(x, y, z) {

  for (let i = 0; i < 4; i++) {
    let randomNumX = randomNumber(-1.5, 1.5);
    let randomNumY = randomNumber(1, 2.5); 
    let randomNumZ = randomNumber(-1.5, 1.5); 
    let randomNumRotation = randomNumber(0, 2*Math.PI); 

    let loaderCloud = new THREE.GLTFLoader();
    let cloudgltf = await loaderCloud.loadAsync("./gltf/cloud.glb");
    let cloud = cloudgltf.scene;
    cloud.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        if (node.material.map) node.material.map.anisotropy = 16;
      }
    });
    cloud.position.set(x + randomNumX, y+randomNumY, z+ randomNumZ); 
    cloud.scale.set(0.05, 0.05, 0.05); 
    cloud.rotation.set(0, randomNumRotation, 0); 
    scene.add(cloud);  

  }
}

/*
  Function: addModelBoundingBox
  Description: 
    Creates a bounding box for the plane model. 
  Parameters: None
*/
function addModelBoundingBox() {
  modelBB = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
  modelBB.setFromObject(model);
}

/*
  Function: removeInstructions
  Description: 
    Runs 15 seconds after onSelect is called. 
    Sets the instuctions text to blank. 
  Parameters: None
*/
function removeInstructions() {
  document.getElementById("instructions").textContent = "";
}
/*********************************************Functions For Buttons*********************************************/

/*
  Function: moveUp
  Description: 
    Rotates the model around the x-axis by PI/16
  Parameters: None
*/
function moveUp() {

  let rotationX = model.rotation.x + Math.PI / 16;

  new TWEEN.Tween(model.rotation).to({ x: rotationX }, 500).start();
  timeout = setTimeout(moveUp, 100);
}

/*
  Function: straightenUp
  Description: 
    Rotates the model around the x-axis by -PI/16
  Parameters: None
*/
function straightenUp() {

  let rotationX = 0;

  new TWEEN.Tween(model.rotation).to({ x: rotationX }, 1000).start();
}

/*
  Function: moveDown
  Description: 
    Rotates the model around the x-axis by -PI/16
  Parameters: None
*/
function moveDown() {
  let rotationX = model.rotation.x - Math.PI / 16;

  new TWEEN.Tween(model.rotation).to({ x: rotationX }, 500).start();

  timeout = setTimeout(moveDown, 100);
}

/*
  Function: straightenDown
  Description: 
    Rotates the model around the x-axis by PI/16
  Parameters: None
*/
function straightenDown() {

  let rotationX = 0;

  new TWEEN.Tween(model.rotation).to({ x: rotationX }, 1000).start();
}

/*
  Function: moveLeft
  Description: 
    Rotates the model around the z-axis by -PI/16 
    Rotates the model around the y-axis by PI/16
  Parameters: None
*/
function moveLeft() {

  let rotationZ = model.rotation.z - Math.PI / 16;
  let rotationY = model.rotation.y + Math.PI / 16;
  let direction = { x: model.rotation.x, y: rotationY, z: rotationZ };

  new TWEEN.Tween(model.rotation).to(direction, 500).start();

  timeout = setTimeout(moveLeft, 100);
}

/*
  Function: straightenLeft
  Description: 
    Rotates the model around the z-axis by PI/16
  Parameters: None
*/
function straightenLeft() {
  let rotationZ = 0;
  let direction = { z: rotationZ };
  new TWEEN.Tween(model.rotation).to(direction, 1000).start();
}

/*
  Function: moveRight
  Description: 
    Rotates the model around the z-axis by PI/16
    Rotates the model around the y-axis by -PI/16
  Parameters: None
*/
function moveRight() {

  let rotationZ = model.rotation.z + Math.PI / 16;
  let rotationY = model.rotation.y - Math.PI / 16;
  let direction = { x: model.rotation.x, y: rotationY, z: rotationZ };

  new TWEEN.Tween(model.rotation).to(direction, 500).start();

  timeout = setTimeout(moveRight, 100);
}

/*
  Function: straightenRight
  Description: 
    Rotates the model around the z-axis by -PI/16
  Parameters: None
*/
function straightenRight() {

  let rotationZ = 0;
  let direction = { z: rotationZ };

  new TWEEN.Tween(model.rotation).to(direction, 1000).start();

}

/*
  Function: dropWater
  Description: 
    Function runs when the drop water button is clicked. 
    Create boxes with physics below the plane model an adds them to an array.
  Parameters: None
*/
function dropWater() {
  let waterAmount = document.getElementById("waterAmount").value;

  if (waterAmount > 0) {
    let waterRadius = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 0.5), new THREE.MeshBasicMaterial());
    waterRadius.position.setFromMatrixPosition(model.matrix);

    let waterBB = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
    waterBB.setFromObject(waterRadius);

    for (let i = 0; i < forest.trees.length; i++) {

      let tree = forest.trees[i];
      let treeBB = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
      treeBB.setFromObject(tree.object3D);

      if (waterBB.intersectsBox(treeBB)) {
        tree.water();
      }
    }

    document.getElementById("waterAmount").value -= 33;

  } else {
    document.getElementById("instructions").textContent = "Out of water! Fly over the lake to get more water."
    setTimeout(removeInstructions, 5000);
  }

}

/**************************************************************************************************************/


function buildForest() {
  forest = new Forest(30, 30, scene, origin);
}

//Runs after forest is finished loading all models and building
//to avoid async conflics nothing should try and make calls on the forest until after this runs
function forestCallback() {
  console.log(forest);
  buildTerrain();
  const testtree = forest.trees[26];
  testtree.light();
  terrainScene.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  addWaterPlane();

}

function buildTerrain() {
  const matLoader = new THREE.TextureLoader();
  const t1 = matLoader.load('./img/sand.jpg');
  const t2 = matLoader.load('./img/grass.jpg');
  const t3 = matLoader.load('./img/stone.jpg');
  const t4 = matLoader.load('./img/snow.jpg');
  const material = THREE.Terrain.generateBlendedMaterial([
    // The first texture is the base; other textures are blended in on top.
    { texture: t1 },
    // Start blending in at height -80; opaque between -35 and 20; blend out by 50
    { texture: t2, levels: [.05, .16, .3, .375] },
    { texture: t3, levels: [.3, .375, .4, .46] },
    // How quickly this texture is blended in depends on its x-position.
    { texture: t4, glsl: '1.0 - smoothstep(65.0 + smoothstep(-256.0, 256.0, vPosition.x) * 10.0, 80.0, vPosition.z)' },
    // Use this texture if the slope is between 27 and 45 degrees
    { texture: t3, glsl: 'slope > 0.7853981633974483 ? 0.2 : 1.0 - smoothstep(0.47123889803846897, 0.7853981633974483, slope) + 0.2' },
  ]);

  var xS = 63, yS = 63;
  let options = {
    easing: THREE.Terrain.Linear,
    frequency: 2.5,
    heightmap: THREE.Terrain.DiamondSquare,
    material: material,
    maxHeight: .5,
    minHeight: 0,
    steps: 1,
    xSegments: xS,
    xSize: 3,
    ySegments: yS,
    ySize: 3,
    samTesting: true
  }
  terrainScene = new THREE.Terrain(options);

  terrainScene.position.set(origin[0], origin[1] - .3, origin[2]);
  scene.add(terrainScene);

  var geo = terrainScene.children[0].geometry;
  var decoScene = forest.scatterTrees(geo, {
    w: xS,
    h: yS,
    spread: 0.2,
    randomness: Math.random,
  });
  terrainScene.add(decoScene[0]);
  const g = new THREE.Vector3(0, 0, 0);
}

//called from render loop every $iterateStep in milliseconds
function iterateFire() {
  forest.iterateFire();
}

//changes the time to next iterate fire from infinity to current time plus $iteratestep
//this starts the loop of fire burning
function startBurning() {
  iterateTime = iterateStep + time;
}

function setupPhysicsWorld() {
  physics = new AmmoPhysics(scene, {
    maxSubSteps: 4,
    fixedTimeStep: 1 / 240,
  })
  if (physicsDebug) {
    physics.debug.enable(true)
  }
  // console.log(physics);
  // console.log(physics.fixedTimeStep);

}

function addWaterPlane() {
  const matLoader = new THREE.TextureLoader();
  const waterHdri = matLoader.load('./img/sky.jpg');
  const waterBump = matLoader.load('./img/waterNormal.jpg');

  const waterMat = new THREE.MeshStandardMaterial({
    color: 4767142,
    roughness: 0,
    metalness: 0,
    emissive: 0,
    bumpMap: waterBump,
    bumpScale: 0.48,
    envMap: waterHdri,
    envMapIntensity: 1,
    depthFunc: 3,
    depthTest: true,
    depthWrite: true,
  })
  waterMat.bumpMap.wrapT = THREE.RepeatWrapping;
  waterMat.bumpMap.repeat.y = 3;
  const waterGeo = new THREE.PlaneGeometry(3, 3);

  waterGeo.rotateX(-Math.PI / 2);
  waterPlane = new THREE.Mesh(waterGeo, waterMat);
  waterPlane.traverse((node) => {
    if (node.isMesh) {
      node.receiveShadow = true;
    }
  });
  scene.add(waterPlane);
  waterPlane.position.set(origin[0], origin[1], origin[2]);

  // adding bounding box over the water source
  waterBB = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
  const water = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1, 3), new THREE.MeshBasicMaterial());
  water.position.set(origin[0] + 0.75, origin[1], origin[2]);
  //scene.add(water); 
  waterBB.setFromObject(water);
}

/**************************************************************************************************************/

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  renderer.setAnimationLoop(render);
}

let hitTestSource = null;
let localSpace = null;
let hitTestSourceInitialized = false;
let planeCreated = false;

async function initializeHitTestSource() {
  const session = renderer.xr.getSession(); // XRSession

  const viewerSpace = await session.requestReferenceSpace("viewer");
  hitTestSource = await session.requestHitTestSource({
    space: viewerSpace,
  });

  localSpace = await session.requestReferenceSpace("local");

  hitTestSourceInitialized = true;

  session.addEventListener("end", () => {
    hitTestSourceInitialized = false;
    hitTestSource = null;
  });
}

function render(timestamp, frame) {
  deltaTime = clock.getDelta();
  if (frame) {

    if (!hitTestSourceInitialized) {
      initializeHitTestSource();
    }

    if (hitTestSourceInitialized) {

      const hitTestResults = frame.getHitTestResults(hitTestSource);

      if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];

        const pose = hit.getPose(localSpace);

        plane.visible = true;
        if (!planeCreated) {
          plane.matrix.fromArray(pose.transform.matrix);
          planeCreated = true;
        }

        reticle.visible = true;

        reticle.matrix.fromArray(pose.transform.matrix);

      } else {
        reticle.visible = false;
      }
    }

    // Start the tween animations
    TWEEN.update();

    // runs if the model is visible
    if (model.visible) {

      // moves the model in the direction it is facing 
      let direction = new THREE.Vector3();
      model.getWorldDirection(direction);
      model.position.add(direction.multiplyScalar(speed * 0.004));

      // updates the bounding box of the model
      modelBB.applyMatrix4(model.matrixWorld);

      // checks if the model is intersecting the out of bounds area and the trees
      checkBoxCollisions();

      // checks if the model is intersecting the water bounding box
      checkWaterCollision();
    }

    updatePhysics(deltaTime * 1000);

    // updating the mixer
    if (mixer) {
      mixer.update(deltaTime);
    }

    renderer.render(scene, camera);
  }
  if (forest && forest.mixers.length > 0) {
    forest.mixers.forEach(mixer => {
      mixer.update(deltaTime);
    })
    //console.log(waterPlane.material);
    waterPlane.material.bumpMap.offset.y = time * 0.00002;
  }
  if (timestamp >= iterateTime) {
    iterateTime += iterateStep;
    iterateFire();
  }

  time = timestamp;

  // moving the spotlight to mimic real lighting
  spotLight.position.set(
    camera.position.x + 10,
    camera.position.y + 10,
    camera.position.z + 10
  );
}

/* 
  Function: checkColllsions
  Description: 
    Determines if the bounding boxes of the cube and the model intersect one another.
    If there is an intersection, writes Congratulations to the screen and removes the cube from the scene. 
    
    Determines if the bounding boxes of the walls and the model intersect. 
    If there is an intersection, the model is turned 180 degrees. 
  Parameters: None
*/
function checkBoxCollisions() {

  if (wallBBFront.intersectsBox(modelBB) || wallBBLeft.intersectsBox(modelBB) || wallBBRight.intersectsBox(modelBB) || wallBBBack.intersectsBox(modelBB)) {

    let movement = new THREE.Vector3();
    model.getWorldDirection(movement);
    model.position.add(movement.multiplyScalar(-1.2));

    let rotationX = model.rotation.x;
    let rotationY = model.rotation.y + Math.PI;
    let rotationZ = model.rotation.z;
    let direction = { x: rotationX, y: rotationY, z: rotationZ };

    new TWEEN.Tween(model.rotation).to(direction, 500).start();

    document.getElementById("instructions").textContent = "We are too far away! I'm turning us back around!";
    setTimeout(removeInstructions, 5000);

  } else if (wallBBGround.intersectsBox(modelBB)) {
    speed = 0;

    document.querySelector("#up").disabled = true;
    document.querySelector("#down").disabled = true;
    document.querySelector("#left").disabled = true;
    document.querySelector("#right").disabled = true;
    document.querySelector("#water").disabled = true;
    document.getElementById("throttleSlider").disabled = true;

    document.getElementById("instructions").textContent = "Oh no! We crashed!";

  } else if (wallBBCeiling.intersectsBox(modelBB)) {
    let movement = new THREE.Vector3();
    model.getWorldDirection(movement);
    model.position.add(movement.multiplyScalar(-1.2));

    let rotationX = model.rotation.x - Math.PI / 16;
    new TWEEN.Tween(model.rotation).to({ x: rotationX }, 500).start();
    setTimeout(straightenDown, 1000);
    document.getElementById("instructions").textContent = "We've flown too high! I'm lowering the altitude!";
    setTimeout(removeInstructions, 5000);
  }

  for (let i = 0; i < forest.trees.length; i++) {

    let tree = forest.trees[i];
    let treeBB = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
    treeBB.setFromObject(tree.object3D);

    if (treeBB.intersectsBox(modelBB)) {
      speed = 0;

      document.querySelector("#up").disabled = true;
      document.querySelector("#down").disabled = true;
      document.querySelector("#left").disabled = true;
      document.querySelector("#right").disabled = true;
      document.querySelector("#water").disabled = true;
      document.getElementById("throttleSlider").disabled = true;

      document.getElementById("instructions").textContent = "Oh no! We crashed!";
    }
  }

}

/*
  Function: checkWaterCollision
  Description: 
    If the model and the water bounding boxes intersect, waterAmount slider is filled to 99% and a message appears on screen 
    telling the user that the tank is full. 
  Parameters: None
*/
function checkWaterCollision() {
  let waterAmount = document.getElementById("waterAmount").value;
  if (waterAmount < 99 && waterBB.intersectsBox(modelBB)) {
    document.getElementById("waterAmount").value = 99;
    document.getElementById("instructions").textContent = "We re-filled our water tank!";
    setTimeout(removeInstructions, 5000);
  }
}

function updatePhysics(deltaTime) {

  // Step world
  physics.update(deltaTime)
  if (physicsDebug) {
    physics.updateDebugger()
  }
}

PhysicsLoader('./lib/ammo', () => Start())