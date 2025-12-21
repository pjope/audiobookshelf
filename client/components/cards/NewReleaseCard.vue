<template>
  <div ref="card" :id="`new-release-card-${index}`" tabindex="0" :style="{ minWidth: coverWidth + 'px', maxWidth: coverWidth + 'px' }" class="absolute rounded-xs z-10 cursor-pointer" @mousedown.prevent @mouseup.prevent @mousemove.prevent @mouseover="mouseover" @mouseleave="mouseleave" @click="clickCard">
    <div :id="`cover-area-${index}`" class="relative w-full top-0 left-0 rounded-sm overflow-hidden z-10 bg-primary box-shadow-book" :style="{ height: coverHeight + 'px ' }">
      <!-- Cover Image with Grayscale -->
      <div class="w-full h-full absolute top-0 left-0 rounded-sm overflow-hidden z-10">
        <div v-show="release && !imageReady" aria-hidden="true" class="absolute top-0 left-0 w-full h-full flex items-center justify-center" :style="{ padding: 0.5 + 'em' }">
          <p :style="{ fontSize: 0.8 + 'em' }" class="text-gray-300 text-center">{{ title }}</p>
        </div>

        <img v-if="release && coverUrl" :alt="`${title}, ${$strings.LabelCover}`" ref="cover" aria-hidden="true" :src="coverUrl" class="relative w-full h-full object-cover transition-all duration-300" :class="imageClasses" @load="imageLoaded" :style="{ opacity: imageReady ? 1 : 0 }" />

        <!-- Placeholder Cover -->
        <div v-if="!coverUrl" class="absolute top-0 left-0 right-0 bottom-0 w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-700 to-gray-900" :style="{ padding: 0.8 + 'em' }">
          <div>
            <p aria-hidden="true" class="text-center" style="color: rgb(247 223 187)" :style="{ fontSize: 0.75 + 'em' }">{{ titleCleaned }}</p>
          </div>
        </div>

        <!-- NEW Badge -->
        <div class="absolute rounded-lg box-shadow-md z-20" :style="{ top: 0.375 + 'em', left: 0.375 + 'em', padding: '0.1em 0.5em' }" style="background-color: #dc2626">
          <p :style="{ fontSize: 0.75 + 'em' }" class="font-bold text-white">{{ $strings.LabelNewBadge || 'NEW' }}</p>
        </div>

        <!-- Series Sequence -->
        <div v-if="sequence" class="absolute rounded-lg bg-black/90 box-shadow-md z-20" :style="{ top: 0.375 + 'em', right: 0.375 + 'em', padding: '0.1em 0.25em' }" style="background-color: #78350f">
          <p :style="{ fontSize: 0.8 + 'em' }">#{{ sequence }}</p>
        </div>

        <!-- Hover Overlay -->
        <div v-show="release && isHovering" class="w-full h-full absolute top-0 left-0 z-10 bg-black/50 rounded-sm flex flex-col items-center justify-center" :style="{ padding: 0.5 + 'em' }">
          <span class="material-symbols text-white" :style="{ fontSize: 2 + 'em' }">open_in_new</span>
          <p class="text-white text-center mt-1" :style="{ fontSize: 0.7 + 'em' }">{{ $strings.LabelNotInLibrary || 'Not in Library' }}</p>
        </div>

        <!-- Dismiss Button -->
        <div v-if="isHovering" class="absolute cursor-pointer hover:text-red-400 text-white/80 hover:scale-125 transform duration-150 bottom-0 right-0" :style="{ padding: 0.375 + 'em' }" @click.stop.prevent="dismissRelease">
          <span class="material-symbols" :style="{ fontSize: 1 + 'em' }">close</span>
        </div>
      </div>
    </div>

    <!-- Title/Author -->
    <div :id="`description-area-${index}`" dir="auto" class="relative mt-2e mb-2e left-0 z-50 w-full">
      <div :style="{ fontSize: 0.9 + 'em' }">
        <ui-tooltip v-if="title" :text="title" plaintext :disabled="!titleTruncated" direction="bottom" :delayOnShow="500" class="flex items-center">
          <p ref="displayTitle" class="truncate">{{ title }}</p>
        </ui-tooltip>
      </div>
      <p class="truncate text-gray-400" :style="{ fontSize: 0.8 + 'em' }">{{ author || '&nbsp;' }}</p>
      <p v-if="seriesName" class="truncate text-gray-500" :style="{ fontSize: 0.7 + 'em' }">{{ seriesName }}</p>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    index: Number,
    width: Number,
    height: {
      type: Number,
      default: 192
    },
    releaseMount: {
      type: Object,
      default: () => null
    }
  },
  data() {
    return {
      isHovering: false,
      release: null,
      imageReady: false,
      titleTruncated: false
    }
  },
  watch: {
    releaseMount: {
      handler(newVal) {
        if (newVal) {
          this.release = newVal
        }
      }
    }
  },
  computed: {
    bookCoverAspectRatio() {
      return this.store.getters['libraries/getBookCoverAspectRatio']
    },
    coverWidth() {
      return this.width || this.coverHeight / this.bookCoverAspectRatio
    },
    coverHeight() {
      return this.height * this.sizeMultiplier
    },
    sizeMultiplier() {
      return this.store.getters['user/getSizeMultiplier']
    },
    store() {
      return this.$store || this.$nuxt.$store
    },
    _release() {
      return this.release || {}
    },
    title() {
      return this._release.title || ''
    },
    author() {
      return this._release.author || ''
    },
    narrator() {
      return this._release.narrator || ''
    },
    sequence() {
      return this._release.sequence || null
    },
    coverUrl() {
      return this._release.coverUrl || null
    },
    asin() {
      return this._release.asin || null
    },
    releaseDate() {
      return this._release.releaseDate || null
    },
    seriesName() {
      return this._release.trackedSeries?.series?.name || this._release.seriesName || null
    },
    titleCleaned() {
      if (!this.title) return ''
      if (this.title.length > 60) {
        return this.title.slice(0, 57) + '...'
      }
      return this.title
    },
    imageClasses() {
      return {
        'grayscale': true,
        'hover:grayscale-50': true
      }
    }
  },
  methods: {
    setEntity(_release) {
      this.release = _release

      this.$nextTick(() => {
        if (this.$refs.displayTitle) {
          this.titleTruncated = this.$refs.displayTitle.scrollWidth > this.$refs.displayTitle.clientWidth
        }
      })
    },
    clickCard() {
      if (this.asin) {
        const audibleUrl = `https://www.audible.com/pd/${this.asin}`
        window.open(audibleUrl, '_blank')
      }
      this.$emit('click', this.release)
    },
    dismissRelease() {
      this.$emit('dismiss', this.release)
    },
    mouseover() {
      this.isHovering = true
    },
    mouseleave() {
      this.isHovering = false
    },
    destroy() {
      this.$destroy()

      if (this.$el && this.$el.parentNode) {
        this.$el.parentNode.removeChild(this.$el)
      } else if (this.$el && this.$el.remove) {
        this.$el.remove()
      }
    },
    imageLoaded() {
      this.imageReady = true
    }
  },
  mounted() {
    if (this.releaseMount) {
      this.setEntity(this.releaseMount)
    }
  }
}
</script>

<style scoped>
.grayscale {
  filter: grayscale(100%);
}
.grayscale:hover,
.hover\:grayscale-50:hover {
  filter: grayscale(50%);
}
</style>
