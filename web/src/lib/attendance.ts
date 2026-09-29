import type { AttendeeView } from '@/api/types'

/**
 * Who's in the room: their retro is open (the stage or their phone), or the facilitator marked them
 * here without a device. One definition, so every count the retro shows agrees — the rail, the
 * vote's "of how many", the recap.
 */
export const isHere = (a: Pick<AttendeeView, 'connected' | 'present'>) => a.connected || a.present
