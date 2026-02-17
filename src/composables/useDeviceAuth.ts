// Device auth for OpenClaw Gateway WebSocket
// Uses Ed25519 signatures to authenticate with device identity

const DEVICE_STORAGE_KEY = 'oc-device-identity'

interface DeviceIdentity {
  deviceId: string
  publicKey: string // base64url raw public key
  privateKey: CryptoKey
  publicKeyPem: string
}

let cachedIdentity: DeviceIdentity | null = null

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - str.length % 4) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function generateDeviceIdentity(): Promise<DeviceIdentity> {
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair

  const rawPublic = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  const publicKeyB64 = base64UrlEncode(rawPublic)

  // Device ID = hex of public key hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', rawPublic)
  const deviceId = arrayBufferToHex(hashBuffer)

  // Export private key for storage
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
  const publicSpki = await crypto.subtle.exportKey('spki', keyPair.publicKey)

  // Store as base64
  const stored = {
    deviceId,
    publicKey: publicKeyB64,
    privateKeyPkcs8: base64UrlEncode(pkcs8),
    publicKeySpki: base64UrlEncode(publicSpki),
  }
  localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(stored))

  return {
    deviceId,
    publicKey: publicKeyB64,
    privateKey: keyPair.privateKey,
    publicKeyPem: '', // not needed for WS
  }
}

async function loadDeviceIdentity(): Promise<DeviceIdentity | null> {
  if (cachedIdentity) return cachedIdentity

  const stored = localStorage.getItem(DEVICE_STORAGE_KEY)
  if (!stored) return null

  try {
    const data = JSON.parse(stored)
    const privateKeyBytes = base64UrlDecode(data.privateKeyPkcs8)
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      privateKeyBytes,
      'Ed25519',
      false,
      ['sign']
    )

    cachedIdentity = {
      deviceId: data.deviceId,
      publicKey: data.publicKey,
      privateKey,
      publicKeyPem: '',
    }
    return cachedIdentity
  } catch (e) {
    console.warn('[DeviceAuth] Failed to load stored identity:', e)
    localStorage.removeItem(DEVICE_STORAGE_KEY)
    return null
  }
}

export async function getOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  const existing = await loadDeviceIdentity()
  if (existing) return existing

  const identity = await generateDeviceIdentity()
  cachedIdentity = identity
  return identity
}

export function buildDeviceAuthPayload(params: {
  deviceId: string
  clientId: string
  clientMode: string
  role: string
  scopes: string[]
  signedAtMs: number
  token: string | null
  nonce?: string
}): string {
  const version = params.nonce ? 'v2' : 'v1'
  const scopes = params.scopes.join(',')
  const token = params.token ?? ''
  const base = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
  ]
  if (version === 'v2') base.push(params.nonce ?? '')
  return base.join('|')
}

export async function signPayload(privateKey: CryptoKey, payload: string): Promise<string> {
  const data = new TextEncoder().encode(payload)
  const signature = await crypto.subtle.sign('Ed25519', privateKey, data)
  return base64UrlEncode(signature)
}
