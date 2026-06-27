import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'
import { Database } from './db'

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  private matchRegex?: RegExp

  constructor(db: Database, service: string, matchRegex: string) {
    super(db, service)
    this.matchRegex = parseRegex(matchRegex)
  }

  async handleEvent(evt: RepoEvent) {
    if (!isCommit(evt)) return

    const ops = await getOpsByType(evt)

    const postsToDelete = ops.posts.deletes.map((del) => del.uri)
    const postsToCreate = ops.posts.creates
      .filter((create) => {
        return (
          isPortuguese(create.record.langs) &&
          this.matchesConfiguredTerms(create.record.text)
        )
      })
      .map((create) => {
        const primaryLang = create.record.langs?.find((lang) =>
          isPortugueseLang(lang),
        )
        return {
          uri: create.uri,
          cid: create.cid,
          text: create.record.text,
          lang: primaryLang ?? 'pt',
          createdAt: create.record.createdAt,
          indexedAt: new Date().toISOString(),
        }
      })

    if (postsToDelete.length > 0) {
      await this.db
        .deleteFrom('custom_post')
        .where('uri', 'in', postsToDelete)
        .execute()
    }
    if (postsToCreate.length > 0) {
      await this.db
        .insertInto('custom_post')
        .values(postsToCreate)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }
  }

  private matchesConfiguredTerms(text: string) {
    if (!this.matchRegex) return false
    this.matchRegex.lastIndex = 0
    return this.matchRegex.test(text)
  }
}

const isPortuguese = (langs?: string[]) => {
  return langs?.some(isPortugueseLang) ?? false
}

const isPortugueseLang = (lang: string) => {
  return lang.toLowerCase() === 'pt' || lang.toLowerCase().startsWith('pt-')
}

const parseRegex = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return undefined

  const literal = trimmed.match(/^\/(.+)\/([dgimsuvy]*)$/)
  if (literal) {
    const { pattern, flags } = normalizeRegexPattern(literal[1], literal[2])
    return new RegExp(pattern, flags)
  }

  const { pattern, flags } = normalizeRegexPattern(trimmed, 'i')
  return new RegExp(pattern, flags)
}

const normalizeRegexPattern = (pattern: string, flags: string) => {
  const pcreCaseInsensitive = pattern.match(/^\(\?i\)(.*)$/)
  if (!pcreCaseInsensitive) return { pattern, flags }

  return {
    pattern: pcreCaseInsensitive[1],
    flags: flags.includes('i') ? flags : `${flags}i`,
  }
}
