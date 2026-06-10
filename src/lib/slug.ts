import { supabase } from './supabase'

export const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/

export function generateSlug(clubName: string): string {
  let slug = clubName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (slug.length < 3) {
    slug = slug + '-' + Math.floor(1000 + Math.random() * 9000)
  }
  if (slug.length > 40) {
    slug = slug.slice(0, 40).replace(/-+$/, '')
  }
  return slug
}

export function validateSlug(s: string): string | null {
  if (!s) return 'Slug is required'
  if (s.length < 3) return 'Must be at least 3 characters'
  if (s.length > 40) return 'Must be 40 characters or less'
  if (!SLUG_REGEX.test(s)) {
    return 'Only lowercase letters, numbers, and hyphens. Cannot start or end with a hyphen.'
  }
  return null
}

export async function isSlugAvailable(slug: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('clubs')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw error
  return data === null
}

export async function findAvailableSlug(base: string): Promise<string> {
  if (await isSlugAvailable(base)) return base
  let suffix = 2
  while (suffix <= 99) {
    const candidate = `${base}-${suffix}`
    if (candidate.length <= 40 && (await isSlugAvailable(candidate))) {
      return candidate
    }
    suffix++
  }
  return base + '-' + Math.floor(1000 + Math.random() * 9000)
}
