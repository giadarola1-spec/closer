import React, { useState, useEffect } from "react"
import { enrichTweet, type EnrichedTweet } from "react-tweet"
import type { Tweet } from "react-tweet/api"
import { Pin } from "lucide-react"

import { cn } from "@/lib/utils"

interface BrandLogoProps {
  className?: string
  [key: string]: unknown
}

const CloserLogo = ({ className, ...props }: BrandLogoProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-label="Go To Truckers — closer"
    className={className}
    {...props}
  >
    <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
    <path d="M15 18H9" />
    <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
    <circle cx="17" cy="18" r="2" />
    <circle cx="7" cy="18" r="2" />
  </svg>
)

const logos = { closer: CloserLogo }

export type TweetLogo = keyof typeof logos

const Verified = ({ className, ...props }: BrandLogoProps) => (
  <svg
    aria-label="Verified Closer"
    viewBox="0 0 24 24"
    className={className}
    {...props}
  >
    <g fill="currentColor">
      <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z" />
    </g>
  </svg>
)

export const truncate = (str: string | null, length: number) => {
  if (!str || str.length <= length) return str
  return `${str.slice(0, length - 3)}...`
}

function getInitials(name: string): string {
  const parts = (name || "C").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "C"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

const Skeleton = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div className={cn("bg-primary/10 rounded-md", className)} {...props} />
  )
}

export const TweetSkeleton = ({
  className,
  ...props
}: {
  className?: string
  [key: string]: unknown
}) => (
  <div
    className={cn(
      "flex size-full max-h-max min-w-72 flex-col gap-2 rounded-2xl border border-[#262624] bg-[#191918] p-4 sm:p-5",
      className
    )}
    {...props}
  >
    <div className="flex flex-row gap-3">
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <Skeleton className="h-10 w-full" />
    </div>
    <Skeleton className="h-20 w-full" />
  </div>
)

export const TweetNotFound = ({
  className,
  ...props
}: {
  className?: string
  [key: string]: unknown
}) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-2 rounded-2xl border border-[#262624] bg-[#191918] p-4",
      className
    )}
    {...props}
  >
    <h3>Post not found</h3>
  </div>
)

const TweetAvatar = ({
  name,
  src,
}: {
  name: string
  src?: string
}) => {
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    setImgError(false)
  }, [src])

  const showImg = Boolean(src && !imgError)

  return (
    <div className="size-10 shrink-0 overflow-hidden rounded-full border border-[#343430] bg-[#242422] text-[#edece8] flex items-center justify-center text-xs font-medium select-none">
      {showImg ? (
        <img
          title={`Profile picture of ${name}`}
          alt={name}
          height={40}
          width={40}
          src={src}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="size-full object-cover"
        />
      ) : (
        <span>{getInitials(name)}</span>
      )}
    </div>
  )
}

export const TweetHeader = ({
  tweet,
  logo = "closer",
  timestamp,
  pinned,
  headerActions,
  onAuthorClick,
}: {
  tweet: EnrichedTweet
  logo?: TweetLogo
  timestamp?: string
  pinned?: boolean
  headerActions?: React.ReactNode
  onAuthorClick?: () => void
}) => {
  const Logo = logos[logo]
  return (
    <div className="flex flex-row items-start justify-between gap-3 tracking-normal">
      <div className="flex items-center space-x-3 min-w-0">
        {onAuthorClick ? (
          <button
            type="button"
            onClick={onAuthorClick}
            className="shrink-0 rounded-full transition-opacity hover:opacity-85"
            title={`Message ${tweet.user.name}`}
          >
            <TweetAvatar
              name={tweet.user.name}
              src={tweet.user.profile_image_url_https}
            />
          </button>
        ) : (
          <div className="shrink-0">
            <TweetAvatar
              name={tweet.user.name}
              src={tweet.user.profile_image_url_https}
            />
          </div>
        )}

        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {onAuthorClick ? (
              <button
                type="button"
                onClick={onAuthorClick}
                className="text-foreground flex items-center font-medium text-sm whitespace-nowrap transition-opacity hover:opacity-80 truncate"
              >
                {truncate(tweet.user.name, 26)}
              </button>
            ) : (
              <span className="text-foreground flex items-center font-medium text-sm whitespace-nowrap truncate">
                {truncate(tweet.user.name, 26)}
              </span>
            )}
            {(tweet.user.verified || tweet.user.is_blue_verified) && (
              <Verified className="inline size-3.5 shrink-0 text-[#a3a29b]" />
            )}
            {pinned && (
              <>
                <span className="text-[#5c5b56]" aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#b5b4ad] shrink-0">
                  <Pin className="w-3 h-3" />
                  Pinned
                </span>
              </>
            )}
          </div>
          <div className="flex items-center space-x-1.5 text-xs text-muted-foreground min-w-0">
            <span className="truncate">@{truncate(tweet.user.screen_name, 22)}</span>
            {timestamp && (
              <>
                <span className="text-[#5c5b56]" aria-hidden="true">·</span>
                <span className="shrink-0 tabular-nums">{timestamp}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {headerActions}
        <span
          className="inline-flex items-center justify-center p-1 text-[#71706b]"
          title="Go To Truckers — closer"
        >
          <Logo className="size-4.5" />
        </span>
      </div>
    </div>
  )
}

export const TweetBody = ({ tweet }: { tweet: EnrichedTweet }) => (
  <div className="text-[14px] leading-relaxed tracking-normal wrap-break-word whitespace-pre-wrap">
    {tweet.entities.map((entity, idx) => {
      switch (entity.type) {
        case "url":
          return (
            <a
              key={idx}
              href={entity.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#b5b4ad] hover:text-white underline underline-offset-2 text-[14px] font-normal transition-colors"
            >
              <span>{entity.text}</span>
            </a>
          )
        case "symbol":
        case "hashtag":
        case "mention":
          return (
            <span
              key={idx}
              className="text-[#b5b4ad] text-[14px] font-normal"
            >
              {entity.text}
            </span>
          )
        case "text":
          return (
            <span
              key={idx}
              className="text-[#e0dfd9] text-[14px] font-normal"
            >
              {entity.text}
            </span>
          )
        default:
          return null
      }
    })}
  </div>
)

export const TweetMedia = ({ tweet }: { tweet: EnrichedTweet }) => {
  if (!tweet.video && !tweet.photos) return null
  return (
    <div className="flex flex-1 items-center justify-center">
      {tweet.video && (
        <video
          poster={tweet.video.poster}
          autoPlay
          loop
          muted
          playsInline
          className="rounded-xl border shadow-sm"
        >
          <source src={tweet.video.variants[0].src} type="video/mp4" />
          Your browser does not support the video tag.
        </video>
      )}
      {tweet.photos && (
        <div className="relative flex transform-gpu snap-x snap-mandatory gap-4 overflow-x-auto">
          <div className="shrink-0 snap-center sm:w-2" />
          {tweet.photos.map((photo) => (
            <img
              key={photo.url}
              src={photo.url}
              width={photo.width}
              height={photo.height}
              title={"Photo by " + tweet.user.name}
              alt={tweet.text}
              className="h-64 w-5/6 shrink-0 snap-center snap-always rounded-xl border object-cover shadow-sm"
            />
          ))}
          <div className="shrink-0 snap-center sm:w-2" />
        </div>
      )}
    </div>
  )
}

const withSafeEntities = <T extends { entities?: Tweet["entities"] }>(
  tweet: T
): T & { entities: Tweet["entities"] } => ({
  ...tweet,
  entities: {
    ...tweet.entities,
    hashtags: tweet.entities?.hashtags ?? [],
    urls: tweet.entities?.urls ?? [],
    symbols: tweet.entities?.symbols ?? [],
    user_mentions: tweet.entities?.user_mentions ?? [],
  },
})

export interface MagicTweetProps {
  tweet: Tweet
  logo?: TweetLogo
  title?: string
  imageUrl?: string | null
  timestamp?: string
  pinned?: boolean
  headerActions?: React.ReactNode
  footer?: React.ReactNode
  onAuthorClick?: () => void
  className?: string
}

export const MagicTweet = ({
  tweet,
  logo = "closer",
  title,
  imageUrl,
  timestamp,
  pinned,
  headerActions,
  footer,
  onAuthorClick,
  className,
  ...props
}: MagicTweetProps) => {
  const [imageLoadFailed, setImageLoadFailed] = useState(false)

  useEffect(() => {
    setImageLoadFailed(false)
  }, [imageUrl])

  const safeImageUrl =
    typeof imageUrl === "string" && /^https:\/\/.+/.test(imageUrl.trim())
      ? imageUrl.trim()
      : null

  const safeTweet: Tweet = {
    ...withSafeEntities(tweet),
    quoted_tweet: tweet.quoted_tweet
      ? withSafeEntities(tweet.quoted_tweet)
      : undefined,
  }
  const enrichedTweet = enrichTweet(safeTweet)
  const hasBodyText = Boolean(tweet.text && tweet.text.trim().length > 0)

  return (
    <article
      className={cn(
        "relative flex h-fit w-full flex-col gap-3 overflow-hidden rounded-2xl border border-[#262624] hover:border-[#32322f] bg-[#191918] p-4 sm:p-5 transition-colors duration-150",
        className
      )}
      {...props}
    >
      <TweetHeader
        tweet={enrichedTweet}
        logo={logo}
        timestamp={timestamp}
        pinned={pinned}
        headerActions={headerActions}
        onAuthorClick={onAuthorClick}
      />
      {title && (
        <h3 className="text-[15px] font-medium text-white leading-snug">
          {title}
        </h3>
      )}
      {hasBodyText && <TweetBody tweet={enrichedTweet} />}
      {safeImageUrl && !imageLoadFailed && (
        <div className="overflow-hidden rounded-xl border border-[#262624] bg-[#141413]">
          <img
            src={safeImageUrl}
            alt={title ? title : `Image posted by ${enrichedTweet.user.name}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageLoadFailed(true)}
            className="block max-h-[440px] w-full object-contain"
          />
        </div>
      )}
      <TweetMedia tweet={enrichedTweet} />
      {footer}
    </article>
  )
}

export const TweetCard = MagicTweet
