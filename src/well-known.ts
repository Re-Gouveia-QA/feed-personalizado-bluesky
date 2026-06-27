import express from 'express'
import { AppContext } from './config'

const makeRouter = (ctx: AppContext) => {
  const router = express.Router()

  router.get('/.well-known/did.json', (req, res) => {
    const serviceDidHostname = getDidWebHostname(ctx.cfg.serviceDid)
    const requestHostname = req.hostname

    if (
      !serviceDidHostname ||
      ![ctx.cfg.hostname, requestHostname].includes(serviceDidHostname)
    ) {
      return res.sendStatus(404)
    }

    res.json({
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: ctx.cfg.serviceDid,
      service: [
        {
          id: '#bsky_fg',
          type: 'BskyFeedGenerator',
          serviceEndpoint: `https://${ctx.cfg.hostname}`,
        },
      ],
    })
  })

  return router
}

const getDidWebHostname = (did: string) => {
  if (!did.startsWith('did:web:')) return undefined
  return did.slice('did:web:'.length).split(':').join('/')
}

export default makeRouter
