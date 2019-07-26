const OSC_RESERVED_USER_NAMES = ["explore", "repositories", "popular", "enterprises", "gists", "dashboard", "languages", "search", "links", "invite", "profile", "organizations", "notifications", "login", "signup", "oauth"]
const OSC_RESERVED_REPO_NAMES = ["admin", "dashboard", "groups", "help", "profile", "projects", "search", "codes", "fork_project", "fork_code"]
const OSC_404_SEL = '#parallax_wrapper'
const OSC_PJAX_CONTAINER_SEL = '#git-project-content'
const OSC_CONTAINERS = '#git-header-nav'
const OSC_RAW_CONTENT = 'body > pre'

class JDGit extends PjaxAdapter {

  constructor(store) {
    super(store)
  }

  // @override
  init($sidebar) {
    const pjaxContainer = $(OSC_PJAX_CONTAINER_SEL)[0]
    super.init($sidebar, { 'pjaxContainer': pjaxContainer })

    // Fix #151 by detecting when page layout is updated.
    // In this case, split-diff page has a wider layout, so need to recompute margin.
    // Note that couldn't do this in response to URL change, since new DOM via pjax might not be ready.
    const diffModeObserver = new window.MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (~mutation.oldValue.indexOf('split-diff') ||
            ~mutation.target.className.indexOf('split-diff')) {
          return $(document).trigger(EVENT.LAYOUT_CHANGE)
        }
      })
    })

    diffModeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true
    })
  }

  // @override
  _getCssClass() {
    return 'octotree_oschina_sidebar'
  }

  // @override
  canLoadEntireTree() {
    return true
  }

  // @override
  getCreateTokenUrl() {
    return `https://gitee.com/api/v5/swagger`
  }

  // @override
  updateLayout(togglerVisible, sidebarVisible, sidebarWidth) {
    const SPACING = 232
    const $containers = $(OSC_CONTAINERS)
    const autoMarginLeft = ($(document).width() - $containers.width()) / 2
    const WIDTH = $(document).width() - SPACING
    const shouldPushLeft = sidebarVisible && (autoMarginLeft <= sidebarWidth + SPACING)

    $('html').css('margin-left', shouldPushLeft ? sidebarWidth : '')
    $containers.css('margin-left', shouldPushLeft ? SPACING : '')
    $containers.css('width', shouldPushLeft ? WIDTH : '')
    // $(".ui.right.floated.horizontal.list").css('margin-right', shouldPushLeft ? 210 : '')
    $(".git-project-download-panel").css('margin-right', shouldPushLeft ? 240 : '')
  }

  // @override
  getRepoFromPath(currentRepo, token, cb) {
    const showInNonCodePage = this.store.get(STORE.NONCODE)

    // 404 page, skip
    if ($(OSC_404_SEL).length) {
      return cb()
    }

    // Skip raw page
    if ($(OSC_RAW_CONTENT).length) {
      return cb()
    }

    // (username)/(reponame)[/(type)]
    const match = window.location.pathname.match(/([^\/]+)\/([^\/]+)(?:\/([^\/]+))?/)
    if (!match) {
      return cb()
    }

    const username = match[1]
    const reponame = match[2]

    // Not a repository, skip
    if (~OSC_RESERVED_USER_NAMES.indexOf(username) ||
        ~OSC_RESERVED_REPO_NAMES.indexOf(reponame)) {
      return cb()
    }

    // Skip non-code page unless showInNonCodePage is true
    if (!showInNonCodePage && match[3] && !~['tree', 'blob'].indexOf(match[3])) {
      return cb()
    }

    // Get branch by inspecting page, quite fragile so provide multiple fallbacks
    const branch =
    // Code page
    $('.project-refs-form .dropdown-toggle-text ').text().trim() ||
    // Pull requests page
    ($('.commit-ref.base-ref').attr('title') || ':').match(/:(.*)/)[1] ||
    // Reuse last selected branch if exist
    (currentRepo.username === username && currentRepo.reponame === reponame && currentRepo.branch) ||
    // Get default branch from cache
    this._defaultBranch[username + '/' + reponame]

    // Still no luck, get default branch for real
    const repo = { username: username, reponame: reponame, branch: branch }

    if (repo.branch) {
      cb(null, repo)
    } else {
      this._get(null, { repo, token }, (err, data) => {
        if (err) return cb(err)
        repo.branch = this._defaultBranch[username + '/' + reponame] = data.default_branch || 'master'
        cb(null, repo)
      })
    }
  }

  // @override
  selectFile(path) {
    // console.log('select file: ' + path)
    const $pjaxContainer = $(OSC_PJAX_CONTAINER_SEL)
    super.selectFile(path, { '$pjaxContainer': $pjaxContainer, fragment: OSC_PJAX_CONTAINER_SEL })
  }

  // @override
  loadCodeTree(opts, cb) {
    opts.encodedBranch = encodeURIComponent(decodeURIComponent(opts.repo.branch))
    opts.path = (opts.node && (opts.node.sha || opts.encodedBranch)) ||
      (opts.encodedBranch + '&recursive=true')
    this._loadCodeTreeInternal(opts, null, cb)
  }

  // @override
  _getTree(path, opts, cb) {
    this._get(`/tree?ref=${path}`, opts, (err, res) => {
      if (err) cb(err)
      else cb(null, res)
    })
  }

  // @override
  _getSubmodules(tree, opts, cb) {
    cb()
  // const item = tree.filter((item) => /^\.gitmodules$/i.test(item.path))[0]
  // if (!item) return cb()
  // this._get(`/git/blobs/${item.sha}`, opts, (err, res) => {
  //     if (err) return cb(err)
  //     const data = atob(res.content.replace(/\n/g, ''))
  //     cb(null, parseGitmodules(data))
  // })
  }

  _get(path, opts, cb) {
    let array = []
    const host = location.protocol + '//' + location.host
    const id = $('#search_project_id').val().trim()

    var request = (page) => {

      var url = `${host}/api/v4/projects/${id}/repository${path || ''}`
      if (opts.token) {
        url += (url.indexOf("?") >= 0 ? "&" : "?") + `private_token=${opts.token}`
      }
      url += '&page='+page
      const cfg = {
        url,
        method: 'GET',
        cache: false,
        xhrFields: {
          withCredentials: true
        },
      }

      $.ajax(cfg)
        .done((data, textStatus, jqXHR) => {
          if (path && path.indexOf('/git/trees') === 0 && data.truncated) {
            this._handleError({ status: 206 }, cb)
          }
          const totalPages  = parseInt(jqXHR.getResponseHeader('x-total-pages'),10)
          array = array.concat(data)
          if (page < totalPages){
            request(page+1)
          }else {
            cb(null, array)
          }
        })
        .fail((jqXHR) => {
          if (retry) {
            request(false)
          } else {
            this._handleError(jqXHR, cb)
          }
        })
    }
    request(1)
  }
}
