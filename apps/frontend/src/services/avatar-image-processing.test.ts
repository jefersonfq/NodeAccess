import { describe, expect, it } from 'vitest'
import {
  AVATAR_ACCEPTED_TYPES,
  avatarImageStyle,
  centeredAvatarOffset,
  clampAvatarOffset,
  isAcceptedAvatarType,
} from './avatar-image-processing'

describe('avatar-image-processing', () => {
  it('accepts only supported avatar image types', () => {
    for (const type of AVATAR_ACCEPTED_TYPES) {
      expect(isAcceptedAvatarType(type)).toBe(true)
    }
    expect(isAcceptedAvatarType('image/gif')).toBe(false)
    expect(isAcceptedAvatarType('application/octet-stream')).toBe(false)
  })

  it('centers portrait images in the circular preview', () => {
    expect(centeredAvatarOffset(600, 1200, 260, 1)).toEqual({
      x: 0,
      y: -130,
      scale: 260 / 600,
    })
  })

  it('centers landscape images in the circular preview', () => {
    expect(centeredAvatarOffset(1200, 600, 260, 1)).toEqual({
      x: -130,
      y: 0,
      scale: 260 / 600,
    })
  })

  it('clamps panning so the preview circle stays covered', () => {
    expect(clampAvatarOffset({
      naturalWidth: 1200,
      naturalHeight: 600,
      previewSize: 260,
      zoom: 1,
      offsetX: 999,
      offsetY: 999,
    })).toMatchObject({
      offsetX: 130,
      offsetY: 0,
      scaledWidth: 520,
      scaledHeight: 260,
    })
  })

  it('returns a stable image style from crop state', () => {
    expect(avatarImageStyle({
      naturalWidth: 1200,
      naturalHeight: 600,
      previewSize: 260,
      zoom: 1.5,
      offsetX: 50,
      offsetY: -25,
    })).toEqual({
      width: '780px',
      height: '390px',
      transform: 'translate(-210px, -90px)',
    })
  })
})
