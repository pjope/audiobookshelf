<template>
  <div class="flex items-center gap-1">
    <button
      class="flex items-center justify-center rounded-full px-3 py-1 transition-all duration-200"
      :class="buttonClasses"
      :disabled="loading"
      @click.stop.prevent="toggleFollow"
    >
      <span v-if="loading" class="material-symbols animate-spin" :style="{ fontSize: iconSize + 'em' }">progress_activity</span>
      <span v-else class="material-symbols" :class="iconClass" :style="{ fontSize: iconSize + 'em' }">{{ isFollowing ? 'notifications_active' : 'notifications_none' }}</span>
      <span v-if="showLabel" class="ml-1" :style="{ fontSize: labelSize + 'em' }">{{ buttonLabel }}</span>
    </button>
    <button
      v-if="isFollowing && showRefresh"
      class="flex items-center justify-center rounded-full p-1 transition-all duration-200 bg-white/10 text-gray-300 hover:bg-white/20 hover:text-white"
      :disabled="refreshLoading"
      :title="$strings.ButtonCheckReleases || 'Check for new releases'"
      @click.stop.prevent="checkReleases"
    >
      <span class="material-symbols" :class="{ 'animate-spin': refreshLoading }" :style="{ fontSize: iconSize + 'em' }">{{ refreshLoading ? 'progress_activity' : 'refresh' }}</span>
    </button>
  </div>
</template>

<script>
export default {
  props: {
    seriesId: {
      type: String,
      required: true
    },
    initialFollowing: {
      type: Boolean,
      default: false
    },
    showLabel: {
      type: Boolean,
      default: true
    },
    iconSize: {
      type: Number,
      default: 1.25
    },
    labelSize: {
      type: Number,
      default: 0.875
    },
    showRefresh: {
      type: Boolean,
      default: true
    }
  },
  data() {
    return {
      loading: false,
      refreshLoading: false,
      isFollowing: false
    }
  },
  computed: {
    buttonClasses() {
      if (this.loading) {
        return 'bg-gray-600 text-gray-400 cursor-wait'
      }
      if (this.isFollowing) {
        return 'bg-success/20 text-success hover:bg-success/30'
      }
      return 'bg-white/10 text-gray-300 hover:bg-white/20 hover:text-white'
    },
    iconClass() {
      return this.isFollowing ? 'text-success' : ''
    },
    buttonLabel() {
      if (this.isFollowing) {
        return this.$strings.ButtonFollowing || 'Following'
      }
      return this.$strings.ButtonFollow || 'Follow'
    }
  },
  watch: {
    initialFollowing: {
      immediate: true,
      handler(val) {
        this.isFollowing = val
      }
    }
  },
  methods: {
    async toggleFollow() {
      if (this.loading) return

      this.loading = true
      try {
        if (this.isFollowing) {
          await this.$axios.$delete(`/api/me/series/${this.seriesId}/follow`)
          this.isFollowing = false
          this.$toast.success(this.$strings.ToastSeriesUnfollowed || 'Stopped following series')
          this.$emit('unfollow', this.seriesId)
        } else {
          await this.$axios.$post(`/api/me/series/${this.seriesId}/follow`)
          this.isFollowing = true
          this.$toast.success(this.$strings.ToastSeriesFollowed || 'Now following series')
          this.$emit('follow', this.seriesId)
        }
      } catch (error) {
        console.error('Failed to toggle series follow', error)
        this.$toast.error(this.$strings.ToastFailedToUpdate || 'Failed to update')
      } finally {
        this.loading = false
      }
    },
    async checkFollowStatus() {
      try {
        const response = await this.$axios.$get(`/api/series/${this.seriesId}/tracking`)
        this.isFollowing = response.isTracking
      } catch (error) {
        console.error('Failed to check follow status', error)
      }
    },
    async checkReleases() {
      if (this.refreshLoading) return

      this.refreshLoading = true
      try {
        const response = await this.$axios.$post(`/api/me/series/${this.seriesId}/check-releases`)
        if (response.count > 0) {
          this.$toast.success(this.$strings.ToastNewReleasesFound?.replace('{0}', response.count) || `Found ${response.count} new release(s)`)
        } else {
          this.$toast.info(this.$strings.ToastNoNewReleases || 'No new releases found')
        }
        this.$emit('releases-checked', response.newReleases)
      } catch (error) {
        console.error('Failed to check releases', error)
        this.$toast.error(this.$strings.ToastFailedToCheck || 'Failed to check releases')
      } finally {
        this.refreshLoading = false
      }
    }
  },
  mounted() {
    if (!this.initialFollowing) {
      this.checkFollowStatus()
    }
  }
}
</script>
