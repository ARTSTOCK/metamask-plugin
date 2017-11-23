const pipe = require('pump')
const Dnode = require('dnode')
const ObjectMultiplex = require('obj-multiplex')
const log = require('loglevel')
const LocalStorageStore = require('obs-store/lib/localStorage')
const storeTransform = require('obs-store/lib/transform')
const ExtensionPlatform = require('./platforms/extension')
const Migrator = require('./lib/migrator/')
const migrations = require('./migrations/')
const MetamaskController = require('./metamask-controller')
const PostMessageDuplexStream = require('post-message-stream')
const firstTimeState = require('./first-time-state')

const STORAGE_KEY = 'metamask-config'
const METAMASK_DEBUG = 'GULP_METAMASK_DEBUG'

window.log = log
log.setDefaultLevel(METAMASK_DEBUG ? 'debug' : 'warn')

const platform = new ExtensionPlatform()

// state persistence
const diskStore = new LocalStorageStore({ storageKey: STORAGE_KEY })

// initialization flow
initialize().catch(log.error)

async function initialize () {
  const initState = await loadStateFromPersistence()
  await setupController(initState)
  log.debug('MetaMask initialization complete.')
}

//
// State and Persistence
//

async function loadStateFromPersistence () {
  // migrations
  const migrator = new Migrator({ migrations })
  // read from disk
  let versionedData = diskStore.getState() || migrator.generateInitialState(firstTimeState)
  // migrate data
  versionedData = await migrator.migrateData(versionedData)
  // write to disk
  diskStore.putState(versionedData)
  // return just the data
  return versionedData.data
}

function setupController (initState) {
  //
  // MetaMask Controller
  //

  const controller = new MetamaskController({
    // User confirmation callbacks:
    showUnconfirmedMessage: triggerUi,
    unlockAccountMessage: triggerUi,
    showUnapprovedTx: triggerUi,
    // initial state
    initState,
    // platform specific api
    platform,
  })
  global.metamaskController = controller

  // setup state persistence
  pipe(
    controller.store,
    storeTransform(versionifyData),
    diskStore
  )

  function versionifyData (state) {
    const versionedData = diskStore.getState()
    versionedData.data = state
    return versionedData
  }

  //
  // connect to other contexts
  //

  function triggerUi () {
    console.log('UI triggered!!')
  }

  const backgroundStream = new PostMessageDuplexStream({
    name: 'background',
    target: 'embededbrowser',
  })

  controller.setupTrustedCommunication(backgroundStream, 'MetaMask')
}
