import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'

export const shortname = 'pt-regex'

export const handler = async (ctx: AppContext, params: QueryParams) => {
  const refreshIntervalMs = ctx.cfg.feedRefreshIntervalMinutes * 60 * 1000
  const latestVisibleTime = new Date(
    Math.floor(Date.now() / refreshIntervalMs) * refreshIntervalMs,
  ).toISOString()

  let builder = ctx.db
    .selectFrom('custom_post')
    .selectAll()
    .where('createdAt', '<=', latestVisibleTime)
    .orderBy('createdAt', 'desc')
    .orderBy('cid', 'desc')
    .limit(params.limit)

  if (params.cursor) {
    const cursor = parseCursor(params.cursor)
    builder = builder.where((eb) =>
      eb.or([
        eb('createdAt', '<', cursor.createdAt),
        eb.and([
          eb('createdAt', '=', cursor.createdAt),
          eb('cid', '<', cursor.cid),
        ]),
      ]),
    )
  }

  const res = await builder.execute()
  const feed = res.map((row) => ({
    post: row.uri,
  }))

  let cursor: string | undefined
  const last = res.at(-1)
  if (last) {
    cursor = `${new Date(last.createdAt).getTime()}::${last.cid}`
  }

  return {
    cursor,
    feed,
  }
}

const parseCursor = (cursor: string) => {
  const [timePart, cid] = cursor.split('::')
  return {
    createdAt: new Date(parseInt(timePart, 10)).toISOString(),
    cid: cid ?? '',
  }
}
