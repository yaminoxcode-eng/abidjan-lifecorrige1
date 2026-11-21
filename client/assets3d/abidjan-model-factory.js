(function (global) {
  'use strict';

  // Abidjan Life — lightweight Three.js asset factory.
  // Compatible with the game's existing THREE r128 global.
  // These factories are additive: they do not alter world coordinates,
  // collision data, character animation pivots, saves or multiplayer state.

  function mat(THREE, color, roughness) {
    return new THREE.MeshStandardMaterial({
      color: color,
      roughness: roughness === undefined ? 0.82 : roughness,
      metalness: 0
    });
  }

  function box(THREE, parent, size, position, material, name) {
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (name) mesh.name = name;
    parent.add(mesh);
    return mesh;
  }

  function wheel(THREE, parent, x, y, z, radius, tireMaterial, hubMaterial) {
    var tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.18, 16), tireMaterial);
    tire.rotation.z = Math.PI / 2;
    tire.position.set(x, y, z);
    tire.castShadow = true;
    parent.add(tire);
    parent.userData.wheels = parent.userData.wheels || [];
    parent.userData.wheels.push(tire);
    var hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.43, radius * 0.43, 0.19, 12), hubMaterial);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(x, y, z);
    parent.add(hub);
  }

  function decorateCharacter(THREE, character, options) {
    options = options || {};
    if (!character || !character.userData || character.userData.abj3dDecorated) return character;
    character.userData.abj3dDecorated = true;

    var details = new THREE.Group();
    details.name = 'AbidjanLifeCharacterDetails';
    character.add(details);

    var beltColor = options.beltColor || 0x28221c;
    var metalColor = options.metalColor || 0xc7a35a;
    var trimColor = options.trimColor || 0xf0e4cf;
    var beltMat = mat(THREE, beltColor);
    var metalMat = mat(THREE, metalColor, 0.42);
    var trimMat = mat(THREE, trimColor);
    var darkMat = mat(THREE, 0x171614);

    // Belt and buckle follow the character root, without touching its rig.
    var belt = new THREE.Mesh(new THREE.CylinderGeometry(0.247, 0.247, 0.055, 16, 1, true), beltMat);
    belt.position.set(0, 0.965, 0);
    details.add(belt);
    box(THREE, details, [0.072, 0.052, 0.018], [0, 0.965, 0.249], metalMat, 'belt-buckle');

    // Shirt collar and a small chest pocket add readable clothing detail.
    var collar = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.014, 6, 16), trimMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, 1.775, 0);
    details.add(collar);
    box(THREE, details, [0.095, 0.105, 0.014], [0.145, 1.49, 0.237], trimMat, 'shirt-pocket');

    // Sole details are attached to the existing animated leg pivots.
    [character.userData.legL, character.userData.legR].forEach(function (leg) {
      if (!leg) return;
      box(THREE, leg, [0.158, 0.032, 0.285], [0, -0.972, 0.065], darkMat, 'shoe-sole');
    });

    // Small eye highlights are parented to the existing head group.
    var head = character.userData.headGroup;
    if (head) {
      var eyeMat = mat(THREE, 0xffffff, 0.3);
      [-1, 1].forEach(function (side) {
        var glint = new THREE.Mesh(new THREE.SphereGeometry(0.007, 6, 5), eyeMat);
        glint.position.set(side * 0.078, 0.045, 0.235);
        head.add(glint);
      });
    }

    character.userData.abj3dDetailsGroup = details;
    return character;
  }

  function createTaxi(THREE, options) {
    options = options || {};
    var group = new THREE.Group();
    group.userData.wheels = [];
    group.name = 'Abidjan_Taxi';
    var yellow = mat(THREE, options.color || 0xf2c230);
    var glass = new THREE.MeshStandardMaterial({ color: 0x8db4c4, roughness: 0.24, metalness: 0.08, transparent: true, opacity: 0.78 });
    var tire = mat(THREE, 0x17191b);
    var hub = mat(THREE, 0xb9c0c4, 0.38);
    var dark = mat(THREE, 0x292b2d);
    var lamp = mat(THREE, 0xfff1c2, 0.35);

    box(THREE, group, [1.82, 0.62, 3.55], [0, 0.72, 0], yellow, 'taxi-body');
    box(THREE, group, [1.48, 0.62, 1.72], [0, 1.31, -0.12], yellow, 'taxi-cabin');
    box(THREE, group, [1.39, 0.43, 0.035], [0, 1.34, 0.755], glass, 'front-windshield');
    box(THREE, group, [1.39, 0.40, 0.035], [0, 1.34, -0.99], glass, 'rear-window');
    [-1, 1].forEach(function (side) {
      box(THREE, group, [0.025, 0.40, 0.72], [side * 0.752, 1.34, -0.53], glass, 'side-window-rear');
      box(THREE, group, [0.025, 0.40, 0.72], [side * 0.752, 1.34, 0.29], glass, 'side-window-front');
      box(THREE, group, [0.12, 0.12, 0.18], [side * 0.91, 1.22, 0.48], dark, 'side-mirror');
      wheel(THREE, group, side * 0.91, 0.39, 1.08, 0.34, tire, hub);
      wheel(THREE, group, side * 0.91, 0.39, -1.08, 0.34, tire, hub);
    });
    [-0.62, 0.62].forEach(function (x) {
      box(THREE, group, [0.34, 0.16, 0.035], [x, 0.82, 1.79], lamp, 'headlight');
    });
    box(THREE, group, [1.72, 0.13, 0.12], [0, 0.49, 1.79], dark, 'front-bumper');
    box(THREE, group, [0.48, 0.13, 0.22], [0, 1.68, -0.1], mat(THREE, 0xf5e7bd), 'taxi-roof-sign');
    group.userData.vehicleType = 'taxi';
    group.traverse(function (node) { if (node.name === 'taxi-body') node.userData.mainBody = true; });
    return group;
  }

  function createGbaka(THREE, options) {
    options = options || {};
    var group = new THREE.Group();
    group.userData.wheels = [];
    group.name = 'Abidjan_Gbaka';
    var body = mat(THREE, options.color || 0xf1eee4);
    var accent = mat(THREE, options.accentColor || 0x168447);
    var glass = new THREE.MeshStandardMaterial({ color: 0x83aebd, roughness: 0.25, transparent: true, opacity: 0.76 });
    var tire = mat(THREE, 0x17191b);
    var hub = mat(THREE, 0xb9c0c4, 0.4);
    var dark = mat(THREE, 0x282a2c);

    box(THREE, group, [1.92, 1.45, 4.55], [0, 1.12, 0], body, 'gbaka-body');
    box(THREE, group, [1.94, 0.20, 4.5], [0, 0.43, 0], accent, 'gbaka-lower-stripe');
    box(THREE, group, [1.55, 0.62, 0.035], [0, 1.55, 2.285], glass, 'gbaka-windshield');
    box(THREE, group, [1.55, 0.54, 0.035], [0, 1.52, -2.285], glass, 'gbaka-rear-window');
    [-1, 1].forEach(function (side) {
      [-1.45, -0.48, 0.49, 1.43].forEach(function (z) {
        box(THREE, group, [0.028, 0.55, 0.72], [side * 0.974, 1.55, z], glass, 'gbaka-side-window');
      });
      wheel(THREE, group, side * 0.99, 0.48, 1.48, 0.39, tire, hub);
      wheel(THREE, group, side * 0.99, 0.48, -1.48, 0.39, tire, hub);
      box(THREE, group, [0.12, 0.13, 0.22], [side * 1.02, 1.7, 1.86], dark, 'gbaka-mirror');
    });
    box(THREE, group, [1.8, 0.12, 0.12], [0, 0.55, 2.31], dark, 'gbaka-bumper');
    [-0.62, 0.62].forEach(function (x) {
      box(THREE, group, [0.30, 0.16, 0.035], [x, 0.94, 2.31], mat(THREE, 0xffefbd), 'gbaka-headlight');
    });
    box(THREE, group, [1.72, 0.13, 0.12], [0, 2.0, 0], accent, 'gbaka-roof-sign');
    group.userData.vehicleType = 'gbaka';
    return group;
  }

  function createMarketStall(THREE, options) {
    options = options || {};
    var group = new THREE.Group();
    group.name = 'Abidjan_Market_Stall';
    var wood = mat(THREE, options.woodColor || 0x80512f);
    var canopy = mat(THREE, options.canopyColor || 0xe9a23b);
    var produce = [0x2e9d4b, 0xe6bd36, 0xd95d39, 0x8b4ba8].map(function (c) { return mat(THREE, c); });
    box(THREE, group, [2.3, 0.14, 1.05], [0, 0.95, 0], wood, 'market-counter');
    box(THREE, group, [2.45, 0.10, 1.2], [0, 2.05, 0], canopy, 'market-canopy');
    [-1, 1].forEach(function (side) {
      [-0.46, 0.46].forEach(function (z) {
        var post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.1, 8), wood);
        post.position.set(side * 1.08, 1.48, z);
        group.add(post);
      });
    });
    for (var i = 0; i < 4; i++) {
      var crate = box(THREE, group, [0.42, 0.22, 0.42], [-0.78 + i * 0.52, 1.13, 0.02], wood, 'produce-crate');
      var fruit = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 7), produce[i]);
      fruit.position.set(crate.position.x, 1.32, 0.02);
      group.add(fruit);
    }
    group.userData.propType = 'market-stall';
    return group;
  }

  function createShopFront(THREE, options) {
    options = options || {};
    var group = new THREE.Group();
    group.name = 'Abidjan_Street_Shop';
    var wall = mat(THREE, options.wallColor || 0xd9c8a5);
    var sign = mat(THREE, options.signColor || 0x174f75);
    var glass = new THREE.MeshStandardMaterial({ color: 0x9abac5, roughness: 0.25, transparent: true, opacity: 0.72 });
    var frame = mat(THREE, 0x3b3026);
    box(THREE, group, [4.2, 2.9, 0.28], [0, 1.45, 0], wall, 'shop-facade');
    box(THREE, group, [2.0, 0.52, 0.10], [0, 2.48, 0.2], sign, 'shop-signboard');
    box(THREE, group, [1.25, 1.45, 0.07], [-1.18, 1.05, 0.2], glass, 'shop-window');
    box(THREE, group, [0.88, 1.9, 0.08], [0.72, 0.96, 0.22], frame, 'shop-door-frame');
    box(THREE, group, [0.76, 1.78, 0.035], [0.72, 0.96, 0.27], glass, 'shop-door-glass');
    box(THREE, group, [2.55, 0.12, 0.72], [0, 2.02, 0.48], mat(THREE, options.awningColor || 0xe5a44b), 'shop-awning');
    group.userData.propType = 'street-shop';
    group.userData.shopLabel = String(options.label || 'COMMERCE');
    return group;
  }

  global.ABJ3DModels = {
    version: '0.1.0',
    decorateCharacter: decorateCharacter,
    createTaxi: createTaxi,
    createGbaka: createGbaka,
    createMarketStall: createMarketStall,
    createShopFront: createShopFront
  };
})(window);
