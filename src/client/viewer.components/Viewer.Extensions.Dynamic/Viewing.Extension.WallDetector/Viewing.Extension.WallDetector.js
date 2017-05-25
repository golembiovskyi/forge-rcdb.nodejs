/////////////////////////////////////////////////////////
// Viewing.Extension.WallDetector
// by Philippe Leefsma, April 2017
//
/////////////////////////////////////////////////////////
import MultiModelExtensionBase from 'Viewer.MultiModelExtensionBase'
import MeshPropertyPanel from './MeshPropertyPanel'
import './Viewing.Extension.WallDetector.scss'
import WidgetContainer from 'WidgetContainer'
import EventTool from 'Viewer.EventTool'
import Toolkit from 'Viewer.Toolkit'
import ThreeBSP from './threeCSG'
import Switch from 'Switch'
import React from 'react'
import d3 from 'd3'

class WallDetectorExtension extends MultiModelExtensionBase {

  /////////////////////////////////////////////////////////
  // Class constructor
  //
  /////////////////////////////////////////////////////////
  constructor (viewer, options) {

    super (viewer, options)

    this.onEnableWireFrame = this.onEnableWireFrame.bind(this)
    this.onFloorClicked = this.onFloorClicked.bind(this)
    this.onMouseMove = this.onMouseMove.bind(this)
    this.renderTitle = this.renderTitle.bind(this)
    this.onClick = this.onClick.bind(this)

    this.eventTool = new EventTool(this.viewer)

    this.react = this.options.react

    this.intersectMeshes = []

    this.wireframe = false
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  get className() {

    return 'wall-detector'
  }

  /////////////////////////////////////////////////////////
  // Extension Id
  //
  /////////////////////////////////////////////////////////
  static get ExtensionId () {

    return 'Viewing.Extension.WallDetector'
  }

  /////////////////////////////////////////////////////////
  // Load callback
  //
  /////////////////////////////////////////////////////////
  load () {

    this.react.setState({

      data: []

    }).then (() => {

      this.react.pushRenderExtension(this)
    })

    console.log('Viewing.Extension.WallDetector loaded')

    this.eventTool.on ('mousemove', this.onMouseMove)

    this.eventTool.on ('singleclick', this.onClick)

    this.meshMaterial = this.createMeshMaterial()

    this.lineMaterial = this.createLineMaterial()

    return true
  }

  /////////////////////////////////////////////////////////
  // Unload callback
  //
  /////////////////////////////////////////////////////////
  unload () {

    console.log('Viewing.Extension.WallDetector unloaded')

    this.eventTool.off()

    super.unload ()

    return true
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  async getComponentBoundingBox (dbId) {

    const model = this.viewer.model

    const fragIds = await Toolkit.getFragIds(
      model, dbId)

    const fragList = model.getFragmentList()

    return this.getModifiedWorldBoundingBox(
      fragIds, fragList)
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  onToolbarCreated (event) {

    this.panel = new MeshPropertyPanel(this.viewer)
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  async onModelCompletedLoad (event) {

    const model = this.viewer.model

    const instanceTree = model.getData().instanceTree

    this.rootId = instanceTree.getRootId()

    const modelBox =
      await this.getComponentBoundingBox(this.rootId)

    const floorsIds =
      await this.getComponentsByParentName(
        'Floors', model)

    const bboxTasks = floorsIds.map((dbId) => {

      return this.getComponentBoundingBox(dbId)
    })

    const boxes = await Promise.all(bboxTasks)

    const extBoxes = boxes.map((box) => {

      const min = {
        x: modelBox.min.x,
        y: modelBox.min.y,
        z: box.min.z
      }

      const max = {
        x: modelBox.max.x,
        y: modelBox.max.y,
        z: box.max.z
      }

      return {
        min,
        max
      }
    })

    const orderedExtBoxes = _.sortBy(extBoxes, (box) => {

      return box.min.z
    })

    const wallIds = await this.getComponentsByParentName(
      'Walls', model)

    const meshTasks = wallIds.map((dbId) => {

      return this.getComponentMesh(dbId)
    })

    const wallMeshes = await Promise.all(meshTasks)

    const wallBSPs = wallMeshes.map((mesh) => {

      const bsp = new ThreeBSP(mesh)

      bsp.dbId = mesh.dbId

      return bsp
    })

    const nbFloors = orderedExtBoxes.length

    const colors = d3.scale.linear()
      .domain([0, nbFloors * .33, nbFloors * .66, nbFloors])
      .range(['#FCB843', '#C2149F', '#0CC4BD', '#0270E9'])

    this.wallMaterials = []

    const data = []

    for (let idx = 0; idx < orderedExtBoxes.length-1; ++idx) {

      const floorBox = {
        max: orderedExtBoxes[idx + 1].min,
        min: orderedExtBoxes[idx].max
      }

      const wallMaterial = new THREE.MeshPhongMaterial({
        side: THREE.DoubleSide,
        color: colors(idx)
      })

      this.viewer.impl.matman().addMaterial(
        this.guid(),
        wallMaterial,
        true)

      this.wallMaterials.push(wallMaterial)

      const floorMesh = this.createBoundingMesh(floorBox)

      const floorBSP = new ThreeBSP(floorMesh)

      const floorWallMeshes = wallBSPs.map((wallBSP) => {

        const resultBSP = floorBSP.intersect(wallBSP)

        const mesh = resultBSP.toMesh(wallMaterial)

        mesh.dbId = wallBSP.dbId

        return mesh
      })

      const dbId = floorsIds[idx]

      data.push({
        name: instanceTree.getNodeName(dbId),
        strokeColor: colors(idx),
        fillColor: colors(idx),
        floorWallMeshes,
        dbId
      })
    }

    this.react.setState({
      data: data.reverse()
    })
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  getComponentsByParentName (name, model) {

    const instanceTree = model.getData().instanceTree

    const rootId = instanceTree.getRootId()

    let floorsId = 0

    instanceTree.enumNodeChildren(rootId,
      (childId) => {

        const nodeName = instanceTree.getNodeName(childId)

        if (nodeName == name) {

          floorsId = childId
        }
      })

    return Toolkit.getLeafNodes(model, floorsId)
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  async getComponentMesh (dbId) {

    const fragIds = await Toolkit.getFragIds(
      this.viewer.model, dbId)

    const vertexArray = []

    fragIds.forEach((fragId) => {

      const renderProxy = this.viewer.impl.getRenderProxy(
        this.viewer.model,
        fragId)

      this.renderProxyToVertexArray(
        renderProxy, vertexArray)
    })

    const geometry = new THREE.Geometry()

    for (var i = 0; i < vertexArray.length; i += 3) {

      geometry.vertices.push(vertexArray[i])
      geometry.vertices.push(vertexArray[i + 1])
      geometry.vertices.push(vertexArray[i + 2])

      const face = new THREE.Face3(i, i + 1, i + 2)

      geometry.faces.push(face)
    }

    const mesh = new THREE.Mesh(
      geometry,
      this.meshMaterial)

    mesh.dbId = dbId

    return mesh
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  renderProxyToVertexArray (proxy, vertexArray) {

    const geometry = proxy.geometry

    const attributes = geometry.attributes
    const positions = geometry.vb ? geometry.vb : attributes.position.array
    const indices = attributes.index.array || geometry.ib
    const stride = geometry.vb ? geometry.vbstride : 3
    let offsets = geometry.offsets

    if (!offsets || offsets.length === 0) {

      offsets = [{start: 0, count: indices.length, index: 0}]
    }

    for (var oi = 0, ol = offsets.length; oi < ol; ++oi) {

      var start = offsets[oi].start
      var count = offsets[oi].count
      var index = offsets[oi].index

      for (var i = start, il = start + count; i < il; i += 3) {

        const a = index + indices[i]
        const b = index + indices[i + 1]
        const c = index + indices[i + 2]

        const vA = new THREE.Vector3()
        const vB = new THREE.Vector3()
        const vC = new THREE.Vector3()

        vA.fromArray(positions, a * stride)
        vB.fromArray(positions, b * stride)
        vC.fromArray(positions, c * stride)

        vA.applyMatrix4(proxy.matrixWorld)
        vB.applyMatrix4(proxy.matrixWorld)
        vC.applyMatrix4(proxy.matrixWorld)

        vertexArray.push(vA)
        vertexArray.push(vB)
        vertexArray.push(vC)
      }
    }
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  createMeshMaterial() {

    const material = new THREE.MeshPhongMaterial({
      color: 0xff0000
    })

    this.viewer.impl.matman().addMaterial(
      'forge-mesh-material',
      material,
      true)

    return material
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  createLineMaterial() {

    const material = new THREE.LineBasicMaterial({
      color: 0x0000ff,
      linewidth: 2
    });

    this.viewer.impl.matman().addMaterial(
      'forge-line-material',
      material,
      true)

    return material
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  drawLine(start, end, material = this.lineMaterial) {

    const geometry = new THREE.Geometry()

    geometry.vertices.push(new THREE.Vector3(
      start.x, start.y, start.z))

    geometry.vertices.push(new THREE.Vector3(
      end.x, end.y, end.z))

    const line = new THREE.Line(geometry, material)

    this.viewer.impl.scene.add(line)
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  createBoundingMesh (bbox, material = this.meshMaterial) {

    const geometry = new THREE.BoxGeometry(
      bbox.max.x - bbox.min.x,
      bbox.max.y - bbox.min.y,
      bbox.max.z - bbox.min.z)

    const mesh = new THREE.Mesh(geometry, material)

    const transform = new THREE.Matrix4()

    transform.makeTranslation(0, 0,
      (bbox.max.z + bbox.min.z) * 0.5)

    mesh.applyMatrix(transform)

    return mesh
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  drawVertex (v, radius, material = this.meshMaterial) {

    const vertex = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 20),
      material)

    vertex.position.set(v.x, v.y, v.z)

    this.viewer.impl.scene.add(vertex)
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  drawMesh (mesh) {

    const geometry = mesh.geometry

    const matrix = mesh.matrixWorld

    //not working
    //geometry.applyMatrix(matrix);

    const attributes = geometry.attributes
    const positions = geometry.vb ? geometry.vb : attributes.position.array
    const indices = attributes.index.array || geometry.ib
    const stride = geometry.vb ? geometry.vbstride : 3
    let offsets = geometry.offsets

    if (!offsets || offsets.length === 0) {

      offsets = [{start: 0, count: indices.length, index: 0}]
    }

    const vA = new THREE.Vector3()
    const vB = new THREE.Vector3()
    const vC = new THREE.Vector3()

    for (var oi = 0, ol = offsets.length; oi < ol; ++oi) {

      var start = offsets[oi].start
      var count = offsets[oi].count
      var index = offsets[oi].index

      for (var i = start, il = start + count; i < il; i += 3) {

        var a = index + indices[i]
        var b = index + indices[i + 1]
        var c = index + indices[i + 2]

        vA.fromArray(positions, a * stride)
        vB.fromArray(positions, b * stride)
        vC.fromArray(positions, c * stride)

        vA.applyMatrix4(matrix)
        vB.applyMatrix4(matrix)
        vC.applyMatrix4(matrix)

        this.drawVertex (vA, 0.25)
        this.drawVertex (vB, 0.25)
        this.drawVertex (vC, 0.25)

        this.drawLine(vA, vB)
        this.drawLine(vB, vC)
        this.drawLine(vC, vA)
      }
    }
  }

  //returns bounding box as it appears in the viewer
  // (transformations could be applied)
  getModifiedWorldBoundingBox (fragIds, fragList) {

    var fragbBox = new THREE.Box3()
    var nodebBox = new THREE.Box3()

    fragIds.forEach(function(fragId) {

      fragList.getWorldBounds(fragId, fragbBox)

      nodebBox.union(fragbBox)
    })

    return nodebBox
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  drawLines (coordsArray, material) {

    const lines = []

    for (var i = 0; i < coordsArray.length; i+=2) {

      var start = coordsArray[i]
      var end = coordsArray[i+1]

      var geometry = new THREE.Geometry()

      geometry.vertices.push(new THREE.Vector3(
        start.x, start.y, start.z))

      geometry.vertices.push(new THREE.Vector3(
        end.x, end.y, end.z))

      geometry.computeLineDistances()

      var line = new THREE.Line(geometry, material)

      this.viewer.impl.scene.add(line)

      lines.push(line)
    }

    return lines
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  drawBox(min, max, material = this.lineMaterial) {

    this.drawLines([

        {x: min.x, y: min.y, z: min.z},
        {x: max.x, y: min.y, z: min.z},

        {x: max.x, y: min.y, z: min.z},
        {x: max.x, y: min.y, z: max.z},

        {x: max.x, y: min.y, z: max.z},
        {x: min.x, y: min.y, z: max.z},

        {x: min.x, y: min.y, z: max.z},
        {x: min.x, y: min.y, z: min.z},

        {x: min.x, y: max.y, z: max.z},
        {x: max.x, y: max.y, z: max.z},

        {x: max.x, y: max.y, z: max.z},
        {x: max.x, y: max.y, z: min.z},

        {x: max.x, y: max.y, z: min.z},
        {x: min.x, y: max.y, z: min.z},

        {x: min.x, y: max.y, z: min.z},
        {x: min.x, y: max.y, z: max.z},

        {x: min.x, y: min.y, z: min.z},
        {x: min.x, y: max.y, z: min.z},

        {x: max.x, y: min.y, z: min.z},
        {x: max.x, y: max.y, z: min.z},

        {x: max.x, y: min.y, z: max.z},
        {x: max.x, y: max.y, z: max.z},

        {x: min.x, y: min.y, z: max.z},
        {x: min.x, y: max.y, z: max.z}],

      material)

    this.viewer.impl.sceneUpdated(true)
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  hexToRgbA (hex, alpha) {

    if(/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {

      var c = hex.substring(1).split('')

      if (c.length == 3) {

        c = [c[0], c[0], c[1], c[1], c[2], c[2]]
      }

      c = '0x' + c.join('')

      return `rgba(${(c>>16)&255},${(c>>8)&255},${c&255},${alpha})`
    }

    throw new Error('Bad Hex Number: ' + hex)
  }

  /////////////////////////////////////////////////////////
  // Creates Raycatser object from the pointer
  //
  /////////////////////////////////////////////////////////
  pointerToRaycaster (domElement, camera, pointer) {

    const pointerVector = new THREE.Vector3()
    const pointerDir = new THREE.Vector3()
    const ray = new THREE.Raycaster()

    const rect = domElement.getBoundingClientRect()

    const x = ((pointer.clientX - rect.left) / rect.width) * 2 - 1
    const y = -((pointer.clientY - rect.top) / rect.height) * 2 + 1

    if (camera.isPerspective) {

      pointerVector.set(x, y, 0.5)

      pointerVector.unproject(camera)

      ray.set(camera.position,
        pointerVector.sub(
          camera.position).normalize())

    } else {

      pointerVector.set(x, y, -1)

      pointerVector.unproject(camera)

      pointerDir.set(0, 0, -1)

      ray.set(pointerVector,
        pointerDir.transformDirection(
          camera.matrixWorld))
    }

    return ray
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  onMouseMove (event) {

    const pointer = event.pointers
      ? event.pointers[0]
      : event

    const rayCaster = this.pointerToRaycaster(
      this.viewer.impl.canvas,
      this.viewer.impl.camera,
      pointer)

    const intersectResults = rayCaster.intersectObjects(
        this.intersectMeshes, true)

    //console.log(intersectResults)
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  onSelection (event) {

    if (event.selections.length) {

      console.log(event.selections[0].dbIdArray[0])
    }
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  onClick (event) {

    const pointer = event.pointers
      ? event.pointers[0]
      : event

    const rayCaster = this.pointerToRaycaster(
      this.viewer.impl.canvas,
      this.viewer.impl.camera,
      pointer)

    const intersectResults = rayCaster.intersectObjects(
      this.intersectMeshes, true)

    if (intersectResults.length) {

      const mesh = intersectResults[0].object

      this.panel.setVisible(false)

      this.panel.setNodeProperties(mesh.dbId)

      this.panel.setVisible(true)
    }
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  onFloorClicked (floor) {

    const state = this.react.getState()

    floor.active = !floor.active

    this.react.setState({
      data: state.data
    })

    const {floorWallMeshes} = floor

    floorWallMeshes.forEach((floorWallMesh) => {

      if (floor.active) {

        this.viewer.impl.scene.add(floorWallMesh)
        this.intersectMeshes.push(floorWallMesh)

      } else {

        this.viewer.impl.scene.remove(floorWallMesh)
      }
    })

    if (!floor.active) {

      const meshIds = floorWallMeshes.map((mesh) => {
        return mesh.id
      })

      this.intersectMeshes =
        this.intersectMeshes.filter((mesh) => {

          return !meshIds.includes(mesh.id)
        })
    }

    this.viewer.impl.sceneUpdated(true)

    const nbActiveFloors = state.data.filter((floor) => {
      return floor.active
    })

    if (nbActiveFloors.length) {

      Toolkit.hide(this.viewer, this.rootId)
      this.eventTool.activate()

    } else {

      Toolkit.show(this.viewer, this.rootId)
      this.eventTool.activate()
    }
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  onEnableWireFrame (checked) {

    this.wireframe = checked

    this.wallMaterials.forEach((material) => {

      material.wireframe = checked
    })

    this.viewer.impl.sceneUpdated(true)
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  async setDocking (docked) {

    const id = WallDetectorExtension.ExtensionId

    if (docked) {

    await this.react.popRenderExtension(id)

      this.react.pushViewerPanel(this, {
        height: 250,
        width: 350
      })

    } else {

    await this.react.popViewerPanel(id)

      this.react.pushRenderExtension(this)
    }
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  renderContent () {

    const state = this.react.getState()

    let hasActiveFloor = false

    const items = state.data.map((floor) => {

      hasActiveFloor = hasActiveFloor || floor.active

      const active = floor.active ? ' active' : ''

      const style = {
        backgroundColor: this.hexToRgbA(floor.fillColor, 0.3),
        border: `2px solid ${floor.strokeColor}`
      }

      return (
        <div key={`item-${floor.dbId}`}
          className={'list-item ' + active}
          onClick={() => this.onFloorClicked(floor)}>
          <div className="item-color" style={style}>
          </div>
          <label>
            {floor.name}
          </label>
        </div>
      )
    })

    return (
      <div className="content">
        <div className="row">
          Select an item to isolate walls on this floor:
        </div>
        <div className="item-list-container">
            {items}
        </div>
        {
          hasActiveFloor &&
          <div className="row">
            Enable wireframe:
          </div>
        }
        {
          hasActiveFloor &&
          <div className="row">
            <Switch className="control-element"
              onChange={this.onEnableWireFrame}
              checked={this.wireframe}/>
          </div>
        }
      </div>
    )
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  renderTitle (docked) {

    const spanClass = docked
      ? 'fa fa-chain-broken'
      : 'fa fa-chain'

    return (
      <div className="title">
        <label>
          Wall Detector
        </label>
        <div className="wall-detector-controls">
          <button onClick={() => this.setDocking(docked)}
            title="Toggle docking mode">
            <span className={spanClass}/>
          </button>
        </div>
      </div>
    )
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  render (opts) {

    return (
      <WidgetContainer
        renderTitle={() => this.renderTitle(opts.docked)}
        showTitle={opts.showTitle}
        className={this.className}>

        { this.renderContent () }

      </WidgetContainer>
    )
  }
}

Autodesk.Viewing.theExtensionManager.registerExtension(
  WallDetectorExtension.ExtensionId,
  WallDetectorExtension)
