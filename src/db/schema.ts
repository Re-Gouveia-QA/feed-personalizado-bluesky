export type DatabaseSchema = {
  post: Post
  custom_post: CustomPost
  sub_state: SubState
}

export type Post = {
  uri: string
  cid: string
  indexedAt: string
}

export type CustomPost = {
  uri: string
  cid: string
  text: string
  lang: string
  createdAt: string
  indexedAt: string
}

export type SubState = {
  service: string
  cursor: number
}
