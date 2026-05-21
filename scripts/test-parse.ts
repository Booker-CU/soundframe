import { parseSoundCloudUrl } from '../lib/utils/soundcloud.js'

async function main() {
  const urls = [
    'https://soundcloud.com/bookzdj/bookz-sol-moon-clip-slimzee-rinse-fm-clip-11925',
    'https://soundcloud.com/e3radiolive/slimzee-08-03-26',
    'https://soundcloud.com/subtleradio/the-mean-streets-show-w-p-jam',
    'https://soundcloud.com/this-is-a-fake-link-12345',
  ]

  for (const url of urls) {
    const result = await parseSoundCloudUrl(url)
    console.log('Input URL:', url)
    console.log('Parse result:', result)
    console.log('---')
  }
}

main().catch((err) => {
  console.error('Error while parsing SoundCloud URL:', err)
})

