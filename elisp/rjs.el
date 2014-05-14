;; rjs.el --- A front-end for rjs

;; Copyright (C) 2011-2014  Jan Erik Hanssen and Anders Bakken

;; Author: Jan Erik Hanssen <jhanssen@gmail.com>
;;         Anders Bakken <agbakken@gmail.com>
;; URL: https://github.com/Andersbakken/rjs

;; This file is not part of GNU Emacs.

;; This program is free software; you can redistribute it and/or modify
;; it under the terms of the GNU General Public License as published by
;; the Free Software Foundation, either version 3 of the License, or
;; (at your option) any later version.

;; This program is distributed in the hope that it will be useful,
;; but WITHOUT ANY WARRANTY; without even the implied warranty of
;; MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
;; GNU General Public License for more details.

;; You should have received a copy of the GNU General Public License
;; along with this program.  If not, see <http://www.gnu.org/licenses/>.

;;; Commentary:

;;; Code:

(defgroup rjs nil
  "Minor mode for rjs."
  :group 'tools
  :prefix "rjs-")

(require 'bookmark)

(if (or (> emacs-major-version 24)
        (and (= emacs-major-version 24)
             (>= emacs-minor-version 3)))
    (require 'cl-lib)
  (eval-when-compile
    (require 'cl)))
(require 'ido)
(require 'thingatpt)

(defvar rjs-last-buffer nil)
(defvar rjs-mode-hook nil)
(defface rjs-path nil "Path" :group 'rjs)
(defface rjs-context nil "Context" :group 'rjs)
(defvar rjs-path-face 'rjs-path "Path part")
(defvar rjs-context-face 'rjs-context "Context part")
(defconst rjs-buffer-name "*RJS*")
(defvar rjs-buffer-bookmarks 0)

(defface rjs-warnline
  '((((class color) (background dark)) (:background "blue"))
    (((class color) (background light)) (:background "blue"))
    (t (:bold t)))
  "Face used for marking error lines."
  :group 'rjs)

(defface rjs-errline
  '((((class color) (background dark)) (:background "red"))
    (((class color) (background light)) (:background "red"))
    (t (:bold t)))
  "Face used for marking warning lines."
  :group 'rjs)

(defvar rjs-font-lock-keywords
  `((,"^\\(.*?,[0-9]+\\)\\(.*\\)$"
     (1 font-lock-string-face)
     (2 font-lock-function-name-face))))

(defun rjs-get-buffer (&optional name)
  (unless name (setq name rjs-buffer-name))
  (if (get-buffer name)
      (kill-buffer name))
  (generate-new-buffer name))

;;;###autoload
(defun rjs-bury-or-delete ()
  (interactive)
  (if (> (length (window-list)) 1)
      (delete-window)
    (bury-buffer)))

(defvar rjs-mode-map nil)
;; assign command to keys
(setq rjs-mode-map (make-sparse-keymap))
(define-key rjs-mode-map (kbd "RET") 'rjs-select-other-window)
(define-key rjs-mode-map (kbd "M-RET") 'rjs-select)
(define-key rjs-mode-map (kbd "ENTER") 'rjs-select-other-window)
(define-key rjs-mode-map [mouse-1] 'rjs-select-other-window)
(define-key rjs-mode-map [mouse-2] 'rjs-select-other-window)
(define-key rjs-mode-map (kbd "M-o") 'rjs-show-in-other-window)
(define-key rjs-mode-map (kbd "s") 'rjs-show-in-other-window)
(define-key rjs-mode-map (kbd "SPC") 'rjs-select-and-remove-rjs-buffer)
(define-key rjs-mode-map (kbd "q") 'rjs-bury-or-delete)
(define-key rjs-mode-map (kbd "j") 'next-line)
(define-key rjs-mode-map (kbd "k") 'previous-line)

(define-derived-mode rjs-mode fundamental-mode
  (set (make-local-variable 'font-lock-defaults) '(rjs-font-lock-keywords))
  (setq mode-name "rjs")
  (use-local-map rjs-mode-map)
  (run-hooks 'rjs-mode-hook)
  (goto-char (point-min))
  (setq buffer-read-only t))

(defun rjs-init-bookmarks()
  (let ((buf (current-buffer)))
    (goto-char (point-min))
    (while (not (eobp))
      (if (looking-at "^\\(.*?\\):\\([0-9]+\\):\\([0-9]+\\)")
          (let ((file (match-string-no-properties 1))
                (line (string-to-number (match-string-no-properties 2)))
                (column (string-to-number (match-string-no-properties 3))))
            (let (deactivate-mark)
              (with-current-buffer (find-file-noselect file)
                (save-restriction
                  (widen)
                  (rjs-goto-line-col line column)
                  (incf rjs-buffer-bookmarks)
                  (bookmark-set (format "R_%d" rjs-buffer-bookmarks))
                  (set-buffer buf))))))
      (forward-line))))

(defun rjs-reset-bookmarks ()
  (while (> rjs-buffer-bookmarks 0)
    (bookmark-delete (format "R_%d" rjs-buffer-bookmarks))
    (decf rjs-buffer-bookmarks)))

;;;###autoload
(defun rjs-next-match () (interactive) (rjs-next-prev-match t))
;;;###autoload
(defun rjs-previous-match () (interactive) (rjs-next-prev-match nil))

(defun rjs-next-prev-suitable-match (next)
  (save-excursion
    (if next
        (goto-char (point-at-bol 2))
      (goto-char (point-at-bol 0)))
    (beginning-of-line)
    (when (looking-at "$")
      (when next
        (goto-char (point-min))
        (beginning-of-line)))
    (point)))

(defun rjs-next-prev-match (next)
  (if (get-buffer rjs-buffer-name)
      (let (target
            (win (get-buffer-window rjs-buffer-name)))
        (if win
            (select-window win))
        (set-buffer rjs-buffer-name)
        (when (> (count-lines (point-max) (point-min)) 1)
          (cond ((and (= (point-at-bol) (point-min)) (not next))
                 (goto-char (point-max))
                 (beginning-of-line)
                 (while (looking-at "$")
                   (goto-char (1- (point))))
                 (message "%s Wrapped" rjs-buffer-name))
                ((and (= (point-at-eol) (point-max)) next)
                 (goto-char (point-min))
                 (setq target (point-min))
                 (message "%s Wrapped" rjs-buffer-name))
                (t
                 (goto-char (rjs-next-prev-suitable-match next))))
          (beginning-of-line)
          (if win (rjs-select-other-window)
            (rjs-select))))))

(defun rjs-executable-find (exe)
  (let ((result (if rjs-path (expand-file-name (concat rjs-path "/src/" exe)))))
    (if (and result (file-executable-p result))
        result
      (executable-find exe))))

(defun rjs-remove-keyword-params (seq)
  (if seq
      (let ((head (car seq))
            (tail (cdr seq)))
        (if (keywordp head) (rjs-remove-keyword-params (cdr tail))
          (cons head (rjs-remove-keyword-params tail))))))

(defun* rjs-call-client (&rest arguments &key noerror (output (current-buffer)) &allow-other-keys)
  (save-excursion
    (let ((client (rjs-executable-find "rjs-client.js")) proc)
      (if (not client)
          (progn
            (unless noerror (error "Can't find rc"))
            nil)
        (setq arguments (cl-remove-if '(lambda (arg) (not arg)) arguments))
        (setq arguments (rjs-remove-keyword-params arguments))

        (rjs-log (concat client " " (combine-and-quote-strings arguments)))
        (let ((status (apply #'call-process client nil output nil arguments)))
          (unless (or noerror (= status 0))
            (message "Error: %d\n%s\n" status (buffer-substring-no-properties (point-min) (point-max))))
          (goto-char (point-min))
          (= status 0))))))


(defun* rjs-goto-location (&key location nobookmark other-window)
  (when (and (> (length location) 0)
             (string-match "\\(.*\\),\\([0-9]+\\)" location))
    (let ((offset (string-to-number (match-string-no-properties 2 location))))
      (rjs-find-file-or-buffer (match-string-no-properties 1 location) other-window)
      (rjs-goto-offset offset)
      (unless nobookmark
        (rjs-location-stack-push))
      t)))

  ;;   (when (> (length location) 0)
  ;;     (cond ((string-match "\\(.*\\):\\([0-9]+\\):\\([0-9]+\\)" location)
  ;;            (let ((line (string-to-number (match-string-no-properties 2 location)))
  ;;                  (column (string-to-number (match-string-no-properties 3 location))))
  ;;              (rjs-find-file-or-buffer (match-string-no-properties 1 location) other-window)
  ;;              (run-hooks rjs-after-find-file-hook)
  ;;              (rjs-goto-line-col line column)
  ;;              (rjs-find-context-on-line)
  ;;              t))
  ;;           ((string-match "\\(.*\\):\\([0-9]+\\)" location)
  ;;            (let ((line (string-to-number (match-string-no-properties 2 location))))
  ;;              (rjs-find-file-or-buffer (match-string-no-properties 1 location) other-window)
  ;;              (run-hooks rjs-after-find-file-hook)
  ;;              (goto-char (point-min))
  ;;              (forward-line (1- line))
  ;;              (rjs-find-context-on-line)
  ;;              t))
  ;;           ((string-match "\\(.*\\),\\([0-9]+\\)" location)
  ;;            (let ((offset (string-to-number (match-string-no-properties 2 location))))
  ;;              (rjs-find-file-or-buffer (match-string-no-properties 1 location) other-window)
  ;;              (run-hooks rjs-after-find-file-hook)
  ;;              (rjs-goto-offset offset)
  ;;              (rjs-find-context-on-line)
  ;;              t))
  ;;           (t
  ;;            (if (string-match "^ +\\(.*\\)$" location)
  ;;                (setq location (match-string-no-properties 1 location)))
  ;;            (rjs-find-file-or-buffer location other-window)))
  ;;     (unless nobookmark (rjs-location-stack-push))))

(defun rjs-current-location ()
  (if (buffer-file-name)
      (concat (buffer-file-name) "," (number-to-string (1- (point))))))

(defun rjs-follow-symbol-at-point ()
  (interactive)
  (let ((loc (rjs-current-location)))
    (unless loc
      (error "RJS: Buffer is not visiting a file"))
    (with-temp-buffer
      (if (rjs-call-client "-f" loc)
          (rjs-goto-location :location (buffer-substring-no-properties (point-at-bol) (point-at-eol)))))))

;; (defun rjs-target (&optional filter)
;;   (let ((path (buffer-file-name))
;;         (location (rjs-current-location))
;;         (context (rjs-current-symbol t)))
;;     (if path
;;         (with-temp-buffer
;;           (rjs-call-rc :path path "-N" "-f" location :context context :path-filter filter :noerror t)
;;           (setq rjs-last-request-not-indexed nil)
;;           (cond ((= (point-min) (point-max))
;;                  (message "Rjs: No target") nil)
;;                 ((or (string= (buffer-string) "Not indexed\n")
;;                      (string= (buffer-string) "Can't seem to connect to server\n"))
;;                  (setq rjs-last-request-not-indexed t) nil)
;;                 (t (buffer-substring-no-properties (point-min) (- (point-max) 1))))))))

(defun rjs-is-js-file (&optional file-or-buffer)
  (cond ((bufferp file-or-buffer)
         (setq file-or-buffer (buffer-file-name file-or-buffer)))
        ((stringp file-or-buffer))
        (t (setq file-or-buffer (buffer-file-name))))
  (if file-or-buffer
      (if (functionp rjs-is-js-file-function)
          (funcall rjs-is-js-file-function file-or-buffer)
        (let ((suffix (file-name-extension file-or-buffer)))
          (and suffix (string= "js" (downcase suffix)))))))

;;;###autoload
(defun rjs-index-buffer (&optional buffer-or-name)
  (interactive)
  (let ((bufname (cond ((stringp buffer-or-name) buffer-or-name)
                       ((bufferp buffer-or-name) (buffer-file-name buffer-or-name))
                       (t buffer-file-name))))
    (if (and bufname (rjs-is-js-file bufname))
        (with-temp-buffer
          (rjs-call-client "--compile" bufname :noerror t))))
  t)

;; (defvar rjs-preprocess-keymap (make-sparse-keymap))
;; (define-key rjs-preprocess-keymap (kbd "q") 'rjs-bury-or-delete)
;; (set-keymap-parent rjs-preprocess-keymap c++-mode-map)
;; (define-derived-mode rjs-preprocess-mode c++-mode
;;   (setq mode-name "rjs-preprocess")
;;   (use-local-map rjs-diagnostics-mode-map)
;;   (if (buffer-file-name)
;;       (error "Set buffer with file %s read only " (buffer-file-name)))
;;   (setq buffer-read-only t))

;; (defun rjs-builds (&optional file)
;;   (with-temp-buffer
;;     (rjs-call-rc :path file "--builds" file)
;;     (buffer-string)))

;; ;;;###autoload
;; (defun rjs-preprocess-file (&optional buffer)
;;   (interactive)
;;   (unless buffer (setq buffer (current-buffer)))
;;   (let (narrow-start narrow-end)
;;     (if (and mark-active
;;              (not (equal (region-beginning) (region-end))))
;;         (setq narrow-start (+ 1 (count-lines (point-min) (region-beginning)))
;;               narrow-end (+ 1 (count-lines (point-min) (region-end)))))
;;     (let ((preprocess-buffer (rjs-get-buffer (format "*Rjs preprocessed %s*" (buffer-file-name buffer)))))
;;       (rjs-location-stack-push)
;;       (with-current-buffer preprocess-buffer
;;         (rjs-call-rc :path (buffer-file-name buffer) "--preprocess" (buffer-file-name buffer))
;;         (if (and narrow-start narrow-end)
;;             (let ((match-regexp (concat "^# \\([0-9]*\\) \"" (file-truename (buffer-file-name buffer)) "\""))
;;                   last-match last-line start end)
;;               (while (re-search-forward match-regexp nil t)
;;                 (let ((current-line (string-to-number (match-string-no-properties 1))))
;;                   (if (and (not start) (> current-line narrow-start))
;;                       (setq start (+ (count-lines (point-min) last-match) (- narrow-start last-line))))
;;                   (if (and (not end) (> current-line narrow-end))
;;                       (setq end (+ (count-lines (point-min) last-match) (- narrow-end last-line))))
;;                   (setq last-line current-line)
;;                   (setq last-match (point))))
;;               (if last-match
;;                   (progn
;;                     (if (not start)
;;                         (setq start (+ (count-lines (point-min) last-match) (- narrow-start last-line))))
;;                     (if (not end)
;;                         (setq end (+ (count-lines (point-min) last-match) (- narrow-end last-line))))))
;;               (if (and start end)
;;                   (progn
;;                     (goto-char (point-min))
;;                     (narrow-to-region (point-at-bol (+ start 1)) (point-at-bol (+ end 1)))))))
;;         (rjs-preprocess-mode))
;;       (display-buffer preprocess-buffer))))

;; ;;;###autoload
;; (defun rjs-reparse-file (&optional buffer)
;;   (interactive)
;;   (let ((file (buffer-file-name buffer)))
;;     (when file
;;       (with-temp-buffer
;;         (rjs-call-rc :path file "-V" file))
;;       (message (format "Dirtied %s" file)))))

;; ;;;###autoload
;; (defun rjs-set-current-project ()
;;   (interactive)
;;   (let ((projects nil)
;;         (project nil)
;;         (current ""))
;;     (with-temp-buffer
;;       (rjs-call-rc :path t "-w")
;;       (goto-char (point-min))
;;       (while (not (eobp))
;;         (let ((line (buffer-substring-no-properties (point-at-bol) (point-at-eol))))
;;           (if (string-match "^\\([^ ]+\\)[^<]*<=$" line)
;;               (let ((name (match-string-no-properties 1 line)))
;;                 (setq projects (add-to-list 'projects name t))
;;                 (setq current name))
;;             (if (string-match "^\\([^ ]+\\)[^<]*$" line)
;;                 (setq projects (add-to-list 'projects (match-string-no-properties 1 line))))))
;;         (forward-line)))
;;     (setq project (ido-completing-read
;;                    (format "Rjs select project (current is %s): " current)
;;                    projects))
;;     (if project
;;         (with-temp-buffer (rjs-call-rc :output nil :path t "-w" project)))))

;; (defun rjs-current-symbol (&optional no-symbol-name)
;;   (or (and mark-active (buffer-substring-no-properties (point) (mark)))
;;       (and (not no-symbol-name) (rjs-current-symbol-name))
;;       (thing-at-point 'symbol)))

;; (defun rjs-cursorinfo (&optional location verbose save-to-kill-ring)
;;   (let ((loc (or location (rjs-current-location)))
;;         (context (unless location (rjs-current-symbol t)))
;;         (path (buffer-file-name)))
;;     (with-temp-buffer
;;       (rjs-call-rc :path path
;;                      :context context
;;                      "-U" loc
;;                      (if verbose "--cursorinfo-include-targets")
;;                      (if verbose "--cursorinfo-include-references"))
;;       (if save-to-kill-ring
;;           (copy-region-as-kill (point-min) (point-max)))
;;       (buffer-string))))

;; ;;;###autoload
;; (defun rjs-print-cursorinfo (&optional prefix)
;;   (interactive "P")
;;   (message "%s" (rjs-cursorinfo nil (not prefix) (not prefix))))

;; ;;;###autoload
;; (defun rjs-print-dependencies (&optional buffer)
;;   (interactive)
;;   (let ((dep-buffer (rjs-get-buffer))
;;         (fn (buffer-file-name (or buffer (current-buffer)))))
;;     (when fn
;;       (rjs-location-stack-push)
;;       (switch-to-buffer dep-buffer)
;;       (rjs-call-rc :path fn "--dependencies" fn)
;;       (rjs-mode))))

;; ;;;###autoload
;; (defun rjs-print-enum-value-at-point (&optional location)
;;   (interactive)
;;   (let ((info (rjs-cursorinfo location)))
;;     (cond ((string-match "^Enum Value: \\([0-9]+\\) *$" info)
;;            (let ((enumval (match-string-no-properties 1 info)))
;;              (message "%s - %s - 0x%X" (rjs-current-symbol-name info) enumval (string-to-number enumval))))
;;           ((string-match "^Type: Enum *$" info)
;;            (let ((target (rjs-target)))
;;              (when target
;;                (setq info (rjs-cursorinfo target))
;;                (if (string-match "^Enum Value: \\([0-9]+\\) *$" info)
;;                    (let ((enumval (match-string-no-properties 1 info)))
;;                      (message "%s - %s - 0x%X" (rjs-current-symbol-name info) enumval (string-to-number enumval)))))))
;;           (t (message "Rjs: No enum here") nil))))

;; (defun rjs-buffer-is-multibyte ()
;;   (string-match "\\butf\\b" (symbol-name buffer-file-coding-system)))

;; (defun rjs-buffer-is-dos()
;;   (string-match "\\bdos\\b" (symbol-name buffer-file-coding-system)))

;; (defun rjs-carriage-returns ()
;;   (if (rjs-buffer-is-dos)
;;       (1- (line-number-at-pos))
;;     0))

;; (defun rjs-offset (&optional p)
;;   (save-excursion
;;     (if p
;;         (goto-char p)
;;       (if (rjs-buffer-is-multibyte)
;;           (let ((prev (buffer-local-value enable-multibyte-characters (current-buffer)))
;;                 (loc (local-variable-p enable-multibyte-characters))
;;                 (pos))
;;             (set-buffer-multibyte nil)
;;             (setq pos (1- (point)))
;;             (set-buffer-multibyte prev)
;;             (unless loc
;;               (kill-local-variable enable-multibyte-characters))
;;             pos)
;;         (1- (point))))))

;;;###autoload
(defun rjs-goto-offset (pos)
  (interactive "NOffset: ")
  (if (rjs-buffer-is-multibyte)
      (let ((prev (buffer-local-value enable-multibyte-characters (current-buffer)))
            (loc (local-variable-p enable-multibyte-characters)))
        (set-buffer-multibyte nil)
        (goto-char (1+ pos))
        (set-buffer-multibyte prev)
        (unless loc
          (kill-local-variable enable-multibyte-characters)))
    (goto-char (1+ pos))))

;; (defun rjs-current-location (&optional offset)
;;   (format "%s:%d:%d" (or (buffer-file-name) (buffer-name))
;;           (line-number-at-pos offset) (1+ (- (or offset (point)) (point-at-bol)))))

(defun rjs-log (log)
  (if rjs-log-enabled
      (with-current-buffer (get-buffer-create "*Rjs Log*")
        (goto-char (point-max))
        (setq buffer-read-only nil)
        (insert "**********************************\n" log "\n")
        (setq buffer-read-only t))))

;; (defvar rjs-symbol-history nil)

;; (defun rjs-save-location ()
;;   (setq rjs-last-buffer (current-buffer))
;;   (rjs-location-stack-push))

(defun rjs-find-file-or-buffer (file-or-buffer &optional other-window)
  (if (file-exists-p file-or-buffer)
      (if other-window
          (find-file-other-window file-or-buffer)
        (find-file file-or-buffer))
    (let ((buf (get-buffer file-or-buffer)))
      (cond ((not buf) (message "No buffer named %s" file-or-buffer))
            (other-window (switch-to-buffer-other-window file-or-buffer))
            (t (switch-to-buffer file-or-buffer))))))

;; (defun rjs-find-context-on-line ()
;;   (if rjs-last-context
;;       (let ((rx (format "\\<%s\\>" rjs-last-context)))
;;         (cond ((looking-at rx))
;;               ((re-search-forward rx (point-at-eol) t)
;;                (backward-char (length rjs-last-context)))
;;               ((re-search-backward rx (point-at-bol) t))
;;               (t)))))

;; (defun rjs-goto-line-col (line column)
;;   (goto-char (point-min))
;;   (forward-line (1- line))
;;   (beginning-of-line)
;;   (forward-char (1- column)))

;; (defun rjs-goto-location (location &optional nobookmark other-window)
;;   "Go to a location passed in. It can be either: file,12 or file:13:14 or plain file"
;;   ;; (message (format "rjs-goto-location \"%s\"" location))
;;   (when (> (length location) 0)
;;     (cond ((string-match "\\(.*\\):\\([0-9]+\\):\\([0-9]+\\)" location)
;;            (let ((line (string-to-number (match-string-no-properties 2 location)))
;;                  (column (string-to-number (match-string-no-properties 3 location))))
;;              (rjs-find-file-or-buffer (match-string-no-properties 1 location) other-window)
;;              (run-hooks rjs-after-find-file-hook)
;;              (rjs-goto-line-col line column)
;;              (rjs-find-context-on-line)
;;              t))
;;           ((string-match "\\(.*\\):\\([0-9]+\\)" location)
;;            (let ((line (string-to-number (match-string-no-properties 2 location))))
;;              (rjs-find-file-or-buffer (match-string-no-properties 1 location) other-window)
;;              (run-hooks rjs-after-find-file-hook)
;;              (goto-char (point-min))
;;              (forward-line (1- line))
;;              (rjs-find-context-on-line)
;;              t))
;;           ((string-match "\\(.*\\),\\([0-9]+\\)" location)
;;            (let ((offset (string-to-number (match-string-no-properties 2 location))))
;;              (rjs-find-file-or-buffer (match-string-no-properties 1 location) other-window)
;;              (run-hooks rjs-after-find-file-hook)
;;              (rjs-goto-offset offset)
;;              (rjs-find-context-on-line)
;;              t))
;;           (t
;;            (if (string-match "^ +\\(.*\\)$" location)
;;                (setq location (match-string-no-properties 1 location)))
;;            (rjs-find-file-or-buffer location other-window)))
;;     (unless nobookmark (rjs-location-stack-push))))

;; (defun rjs-find-symbols-by-name-internal (prompt switch &optional filter regexp-filter)
;;   (rjs-save-location)
;;   (let ((tagname (if mark-active
;;                      (buffer-substring-no-properties (region-beginning) (region-end))
;;                    (rjs-current-symbol)))
;;         (path (buffer-file-name))
;;         input)
;;     (if (> (length tagname) 0)
;;         (setq prompt (concat prompt ": (default " tagname ") "))
;;       (setq prompt (concat prompt ": ")))
;;     (setq input (completing-read prompt (function rjs-symbolname-complete) nil nil nil 'rjs-symbol-history))
;;     (setq rjs-symbol-history (cl-remove-duplicates rjs-symbol-history :from-end t :test 'equal))
;;     (if (not (equal "" input))
;;         (setq tagname input))
;;     (with-current-buffer (rjs-get-buffer)
;;       (rjs-call-rc :path path switch tagname :path-filter filter :context tagname :path-filter-regex regexp-filter)
;;       (rjs-reset-bookmarks)
;;       (rjs-handle-results-buffer))))

;; ;;;###autoload
;; (defun rjs-remove-results-buffer ()
;;   (interactive)
;;   (kill-buffer (current-buffer))
;;   (switch-to-buffer rjs-last-buffer))

;; (defun rjs-symbolname-completion-get (string)
;;   (with-temp-buffer
;;     (rjs-call-rc "-Y" "-S" string)
;;     (eval (read (buffer-string)))))

;; (defun rjs-symbolname-completion-exactmatch (string)
;;   (with-temp-buffer
;;     (rjs-call-rc "-N" "-F" string)
;;     (> (point-max) (point-min))))

;; (defun rjs-symbolname-complete (string predicate code)
;;   (cond ((eq code nil)
;;          (try-completion string (rjs-symbolname-completion-get string) predicate))
;;         ((eq code t) (rjs-symbolname-completion-get string))
;;         ((eq code 'lambda) (rjs-symbolname-completion-exactmatch string))))

(defvar rjs-location-stack-index 0)
(defvar rjs-location-stack nil)

(defun rjs-location-stack-push ()
  (let ((bm (rjs-current-location)))
    (while (> rjs-location-stack-index 0)
      (decf rjs-location-stack-index)
      (pop rjs-location-stack))
    (unless (string= bm (nth 0 rjs-location-stack))
      (push bm rjs-location-stack)
      (if (> (length rjs-location-stack) rjs-max-bookmark-count)
          (nbutlast rjs-location-stack (- (length rjs-location-stack) rjs-max-bookmark-count))))))

;;;###autoload
(defun rjs-location-stack-jump (by)
  (interactive)
  (setq rjs-last-context nil)
  (let ((instack (nth rjs-location-stack-index rjs-location-stack))
        (cur (rjs-current-location)))
    (if (not (string= instack cur))
        (rjs-goto-location instack t)
      (let ((target (+ rjs-location-stack-index by)))
        (when (and (>= target 0) (< target (length rjs-location-stack)))
          (setq rjs-location-stack-index target)
          (rjs-goto-location (nth rjs-location-stack-index rjs-location-stack) t))))))

;; ;; **************************** API *********************************

(defcustom rjs-enabled t
  "Whether rjs is enabled. We try to do nothing when it's not"
  :group 'rjs
  :type 'boolean)

;; (defcustom rjs-sort-references-by-input t
;;   "Whether rjs sorts the references based on the input to rjs-find-references.*"
;;   :group 'rjs
;;   :type 'boolean)

;; (defcustom rjs-completions-enabled nil
;;   "Whether completions are enabled"
;;   :group 'rjs
;;   :type 'boolean)

;; (defcustom rjs-completions-timer-interval .5
;;   "Interval for completions timer"
;;   :group 'rjs
;;   :type 'number)

;; (defcustom rjs-tracking nil
;;   "When on automatically jump to symbol under cursor in *Rjs* buffer"
;;   :group 'rjs
;;   :type 'boolean)

;; (defcustom rjs-error-timer-interval .5
;;   "Interval for minibuffer error timer"
;;   :group 'rjs
;;   :type 'number)

;; (defcustom rjs-display-current-error-as-message t
;;   "Display error under cursor using (message)"
;;   :type 'boolean
;;   :group 'rjs)

;; (defcustom rjs-display-current-error-as-tooltip nil
;;   "Display error under cursor using popup-tip (requires 'popup)"
;;   :type 'boolean
;;   :group 'rjs)

;; (defcustom rjs-error-timer-interval .5
;;   "Interval for minibuffer error timer"
;;   :group 'rjs
;;   :type 'number)

;; (defcustom rjs-tracking-timer-interval .5
;;   "Interval for tracking timer"
;;   :group 'rjs
;;   :type 'number)

;; (defcustom rjs-expand-function '(lambda () (dabbrev-expand nil))
;;   "What function to call for expansions"
;;   :group 'rjs
;;   :type 'function)

;; (defcustom rjs-after-find-file-hook nil
;;   "Run after rjs has jumped to a location possibly in a new file"
;;   :group 'rjs
;;   :type 'hook)

;; (defcustom rjs-mode-hook nil
;;   "Run when rjs-mode is started"
;;   :group 'rjs
;;   :type 'hook)

;; (defcustom rjs-edit-hook nil
;;   "Run before rjs tries to modify a buffer (from rjs-rename)
;; return t if rjs is allowed to modify this file"
;;   :group 'rjs
;;   :type 'hook)

;; (defcustom rjs-jump-to-first-match t
;;   "If t, jump to first match"
;;   :group 'rjs
;;   :type 'boolean)

;; (defcustom rjs-timeout nil
;;   "Max amount of ms to wait before timing out requests"
;;   :group 'rjs
;;   :type 'integer)

(defcustom rjs-path nil
  "Path to rjs executables"
  :group 'rjs
  :type 'string)

;; (defcustom rjs-max-bookmark-count 100
;;   "How many bookmarks to keep in stack"
;;   :group 'rjs
;;   :type 'integer)

(defcustom rjs-log-enabled t
  "If t, log rjs commands and responses"
  :group 'rjs
  :type 'boolean)

;; (defcustom rjs-show-containing-function nil
;;   "If t, pass -o to rc to include containing function"
;;   :group 'rjs
;;   :type 'boolean)

;; (defcustom rjs-index-js-files nil
;;   "If t, automatically index all js files that are opened"
;;   :group 'rjs
;;   :type 'boolean)

;; ;;;###autoload
;; (defun rjs-enable-standard-keybindings (&optional map prefix)
;;   (interactive)
;;   (unless map
;;     (setq map c-mode-base-map))
;;   (unless prefix
;;     (setq prefix "\C-xr"))
;;   (ignore-errors
;;     (define-key map (concat prefix ".") (function rjs-find-symbol-at-point))
;;     (define-key map (concat prefix ",") (function rjs-find-references-at-point))
;;     (define-key map (concat prefix "v") (function rjs-find-virtuals-at-point))
;;     (define-key map (concat prefix "V") (function rjs-print-enum-value-at-point))
;;     (define-key map (concat prefix "/") (function rjs-find-all-references-at-point))
;;     (define-key map (concat prefix "Y") (function rjs-cycle-overlays-on-screen))
;;     (define-key map (concat prefix ">") (function rjs-find-symbol))
;;     (define-key map (concat prefix "<") (function rjs-find-references))
;;     (define-key map (concat prefix "[") (function rjs-location-stack-back))
;;     (define-key map (concat prefix "]") (function rjs-location-stack-forward))
;;     (define-key map (concat prefix "D") (function rjs-diagnostics))
;;     (define-key map (concat prefix "G") (function rjs-guess-function-at-point))
;;     (define-key map (concat prefix "p") (function rjs-set-current-project))
;;     (define-key map (concat prefix "P") (function rjs-print-dependencies))
;;     (define-key map (concat prefix "e") (function rjs-reparse-file))
;;     (define-key map (concat prefix "E") (function rjs-preprocess-file))
;;     (define-key map (concat prefix "R") (function rjs-rename-symbol))
;;     (define-key map (concat prefix "U") (function rjs-print-cursorinfo))
;;     (define-key map (concat prefix "O") (function rjs-goto-offset))
;;     (define-key map (concat prefix ";") (function rjs-find-file))
;;     (define-key map (concat prefix "F") (function rjs-fixit))
;;     (define-key map (concat prefix "x") (function rjs-fix-fixit-at-point))
;;     (define-key map (concat prefix "B") (function rjs-show-rjs-buffer))
;;     (define-key map (concat prefix "I") (function rjs-imenu))
;;     (define-key map (concat prefix "T") (function rjs-taglist))))

;; (if rjs-index-js-files
;;     (add-hook 'find-file-hook 'rjs-index-js-file)
;;   (remove-hook 'find-file-hook 'rjs-index-js-file))

;; ;;;###autoload
;; (defun rjs-print-current-location ()
;;   (interactive)
;;   (message (rjs-current-location)))

;; ;;;###autoload
;; (defun rjs-quit-rdm () (interactive)
;;   (call-process (rjs-executable-find "rc") nil nil nil "--quit-rdm"))

;;;###autoload
(defun rjs-location-stack-forward ()
  (interactive)
  (rjs-location-stack-jump -1))

;;;###autoload
(defun rjs-location-stack-back ()
  (interactive)
  (rjs-location-stack-jump 1))

;;;###autoload
(defun rjs-location-stack-reset ()
  (interactive)
  (setq rjs-location-stack nil)
  (setq rjs-location-stack-index 0))

;; (defun rjs-target (&optional filter)
;;   (let ((path (buffer-file-name))
;;         (location (rjs-current-location))
;;         (context (rjs-current-symbol t)))
;;     (if path
;;         (with-temp-buffer
;;           (rjs-call-rc :path path "-N" "-f" location :context context :path-filter filter :noerror t)
;;           (setq rjs-last-request-not-indexed nil)
;;           (cond ((= (point-min) (point-max))
;;                  (message "Rjs: No target") nil)
;;                 ((or (string= (buffer-string) "Not indexed\n")
;;                      (string= (buffer-string) "Can't seem to connect to server\n"))
;;                  (setq rjs-last-request-not-indexed t) nil)
;;                 (t (buffer-substring-no-properties (point-min) (- (point-max) 1))))))))

;; ;; (defalias 'rjs-find-symbol-at-point 'rjs-follow-symbol-at-point)
;; ;;;###autoload
;; (defun rjs-find-symbol-at-point (&optional prefix)
;;   "Find the natural target for the symbol under the cursor and moves to that location.
;; For references this means to jump to the definition/declaration of the referenced symbol (it jumps to the definition if it is indexed).
;; For definitions it jumps to the declaration (if there is only one) For declarations it jumps to the definition.
;; If called with a prefix restrict to current buffer"
;;   (interactive "P")
;;   (rjs-save-location)
;;   (let ((target (rjs-target prefix)))
;;     (if target
;;         (rjs-goto-location target))))

;; ;;;###autoload
;; (defun rjs-find-references-at-point (&optional prefix)
;;   "Find all references to the symbol under the cursor
;; If there's exactly one result jump directly to it.
;; If there's more show a buffer with the different alternatives and jump to the first one if rjs-jump-to-first-match is true.
;; References to references will be treated as references to the referenced symbol"
;;   (interactive "P")
;;   (rjs-save-location)
;;   (let ((arg (rjs-current-location))
;;         (fn (buffer-file-name))
;;         (context (rjs-current-symbol t)))
;;     (with-current-buffer (rjs-get-buffer)
;;       (rjs-call-rc :path fn :context context :path-filter prefix "-r" arg)
;;       (rjs-handle-results-buffer))))

;; ;;;###autoload
;; (defun rjs-find-virtuals-at-point (&optional prefix)
;;   "List all reimplentations of function under cursor. This includes both declarations and definitions"
;;   (interactive "P")
;;   (rjs-save-location)
;;   (let ((arg (rjs-current-location))
;;         (fn (buffer-file-name))
;;         (context (rjs-current-symbol t)))
;;     (with-current-buffer (rjs-get-buffer)
;;       (rjs-call-rc :path fn :context context :path-filter prefix "-r" arg "-k")
;;       (rjs-handle-results-buffer))))

;; ;;;###autoload
;; (defun rjs-find-all-references-at-point (&optional prefix)
;;   (interactive "P")
;;   (rjs-save-location)
;;   (let ((arg (rjs-current-location))
;;         (fn (buffer-file-name))
;;         (context (rjs-current-symbol t)))
;;     (with-current-buffer (rjs-get-buffer)
;;       (rjs-call-rc :path fn :context context :path-filter prefix "-r" arg "-e")
;;       (rjs-handle-results-buffer))))

;; ;;;###autoload
;; (defun rjs-guess-function-at-point()
;;   (interactive)
;;   (rjs-save-location)
;;   (let ((token (rjs-current-token))
;;         (fn (buffer-file-name))
;;         (context (rjs-current-symbol t)))
;;     (if token
;;         (with-current-buffer (rjs-get-buffer)
;;           (rjs-call-rc :path fn "--declaration-only" "-F" token)
;;           (rjs-handle-results-buffer t)))))

;; (defun rjs-current-token ()
;;   (save-excursion
;;     (when (looking-at "[0-9A-Za-z_~#]")
;;       (while (and (> (point) (point-min)) (looking-at "[0-9A-Za-z_~#]"))
;;         (backward-char))
;;       (if (not (looking-at "[0-9A-Za-z_~#]"))
;;           (forward-char))
;;       (let ((start (point)))
;;         (while (looking-at "[0-9A-Za-z_~#]")
;;           (forward-char))
;;         (buffer-substring-no-properties start (point))))))

;; ;;;###autoload
;; (defun rjs-rename-symbol ()
;;   (interactive)
;;   (save-some-buffers) ;; it all kinda falls apart when buffers are unsaved
;;   (let (location len file pos destructor replacewith prev (modifications 0) (filesopened 0) replacements buffers)
;;     (save-excursion
;;       (if (looking-at "[0-9A-Za-z_~#]")
;;           (progn
;;             (while (and (> (point) (point-min)) (looking-at "[0-9A-Za-z_~#]"))
;;               (backward-char))
;;             (if (not (looking-at "[0-9A-Za-z_~#]"))
;;                 (forward-char))
;;             (setq file (buffer-file-name (current-buffer)))
;;             (setq pos (point))
;;             (if (looking-at "~")
;;                 (progn
;;                   (setq pos (+ pos 1))
;;                   (setq destructor t)))
;;             (while (looking-at "[0-9A-Za-z_~#]")
;;               (forward-char))
;;             (setq prev (buffer-substring-no-properties pos (point)))
;;             (setq len (- (point) pos))
;;             (setq replacewith (read-from-minibuffer (format "Replace '%s' with: " prev)))
;;             (unless (equal replacewith "")
;;               (if destructor
;;                   (decf pos))
;;               (goto-char pos)
;;               (setq location (rjs-current-location))
;;               (setq pos (rjs-offset pos))
;;               (with-temp-buffer
;;                 (rjs-call-rc :path file "-e" "-O" "-N" "-r" location :context prev)
;;                 ;; (message "Got renames %s" (buffer-string))
;;                 (dolist (line (split-string (buffer-string) "\n" t))
;;                   (if (string-match "^\\(.*\\):\\([0-9]+\\):\\([0-9]+\\):$" line)
;;                       (add-to-list 'replacements (cons (match-string-no-properties 1 line)
;;                                                        (cons (string-to-number (match-string-no-properties 2 line))
;;                                                              (string-to-number (match-string-no-properties 3 line)))) t))))
;;               ;; (message "Got %d replacements" (length replacements))

;;               (dolist (value replacements)
;;                 (let ((buf (find-buffer-visiting (car value))))
;;                   (unless buf
;;                     (progn
;;                       (incf filesopened)
;;                       (setq buf (find-file-noselect (car value)))))
;;                   (when buf
;;                     (set-buffer buf)
;;                     (add-to-list 'buffers buf)
;;                     (when (run-hook-with-args-until-failure 'rjs-edit-hook)
;;                       (incf modifications)
;;                       (rjs-goto-line-col (cadr value) (cddr value))
;;                       (rjs-find-context-on-line)
;;                       (if (looking-at "~")
;;                           (forward-char))

;;                       ;; (message "About to replace %s with %s at %d in %s"
;;                       ;;          (buffer-substring-no-properties (point) (+ (point) len)) replacewith (point) (car value))
;;                       (delete-char len)
;;                       (insert replacewith)))))))))
;;     (dolist (value buffers)
;;       (with-current-buffer value
;;         (basic-save-buffer)))
;;     (message (format "Opened %d new files and made %d modifications" filesopened modifications))))

;; ;;;###autoload
;; (defun rjs-find-symbol (&optional prefix)
;;   (interactive "P")
;;   (rjs-find-symbols-by-name-internal "Find rsymbol" "-F" (and prefix buffer-file-name)))

;; ;;;###autoload
;; (defun rjs-find-references (&optional prefix)
;;   (interactive "P")
;;   (rjs-find-symbols-by-name-internal "Find rreferences" "-R" (and prefix buffer-file-name)))

;; ;;;###autoload
;; (defun rjs-find-symbol-current-file ()
;;   (interactive)
;;   (rjs-find-symbol t))

;; ;;;###autoload
;; (defun rjs-find-references-current-file ()
;;   (interactive)
;;   (rjs-find-references t))

;; (defun rjs-dir-filter ()
;;   (concat (substring buffer-file-name
;;                      0
;;                      (string-match
;;                       "[^/]*/?$"
;;                       buffer-file-name))
;;           "[^/]* "))

;; ;;;###autoload
;; (defun rjs-find-symbol-current-dir ()
;;   (interactive)
;;   (rjs-find-symbols-by-name-internal "Find rsymbol" "-F" (rjs-dir-filter) t))

;; ;;;###autoload
;; (defun rjs-find-references-current-dir ()
;;   (interactive)
;;   (rjs-find-symbols-by-name-internal "Find rreferences" (rjs-dir-filter) t))

;; (defvar rjs-diagnostics-process nil)
;; ;;;###autoload
;; (defun rjs-apply-fixit-at-point ()
;;   (interactive)
;;   (let ((line (buffer-substring-no-properties (point-at-bol) (point-at-eol))))
;;     (if (string-match "^\\(.*\\):[0-9]+:[0-9]+: fixit: \\([0-9]+\\)-\\([0-9]+\\): .*did you mean '\\(.*\\)'\\?$" line)
;;         (let* ((file (match-string-no-properties 1 line))
;;                (buf (find-buffer-visiting file))
;;                (start (string-to-number (match-string-no-properties 2 line)))
;;                (end (string-to-number (match-string-no-properties 3 line)))
;;                (text (match-string-no-properties 4 line)))
;;           (unless buf
;;             (setq buf (find-file-noselect file)))
;;           (when (and buf
;;                      (or (not (buffer-modified-p buf))
;;                          (y-or-n-p (format "%s is modified. This is probably not a good idea. Are you sure? " file))))
;;             (let ((win (get-buffer-window buf)))
;;               (if win
;;                   (select-window win)
;;                 (switch-to-buffer-other-window buf)))
;;             (save-excursion
;;               (rjs-goto-offset start)
;;               (delete-char (- end start)) ;; may be 0
;;               (insert text)))))))

;; (defvar rjs-overlays (make-hash-table :test 'equal))

;; (defun rjs-overlays-remove (filename)
;;   (let ((errorlist (gethash filename rjs-overlays nil)))
;;     (while (and errorlist (listp errorlist))
;;       (delete-overlay (car errorlist))
;;       (setq errorlist (cdr errorlist)))
;;     (puthash filename nil rjs-overlays)))

;; ;;;###autoload
;; (defun rjs-clear-diagnostics-overlays()
;;   (interactive)
;;   (if (buffer-file-name)
;;       (rjs-overlays-remove (buffer-file-name))))

;; (defun rjs-really-find-buffer (fn)
;;   (setq fn (file-truename fn))
;;   (car
;;    (cl-member-if #'(lambda (arg)
;;                      (and (buffer-file-name arg)
;;                           (string= fn (file-truename (buffer-file-name arg)))))
;;                  (buffer-list))))

;; (defun rjs-string-to-number (string)
;;   (when (stringp string)
;;     (string-to-number string)))

;; (defun rjs-parse-xml-string (xml)
;;   (with-temp-buffer
;;     (insert xml)
;;     (if (fboundp 'libxml-parse-xml-region)
;;         (libxml-parse-xml-region (point-min) (point-max))
;;       (car (xml-parse-region (point-min) (point-max))))))

;; (defun rjs-parse-overlay-error-node (node filename)
;;   (when (listp node)
;;     (let* ((name (car node))
;;            (attrs (cadr node))
;;            (line (rjs-string-to-number (cdr (assq 'line attrs))))
;;            (column (rjs-string-to-number (cdr (assq 'column attrs))))
;;            (startoffset (rjs-string-to-number (cdr (assq 'startOffset attrs))))
;;            (endoffset (rjs-string-to-number (cdr (assq 'endOffset attrs))))
;;            (severity (cdr (assq 'severity attrs)))
;;            (message (cdr (assq 'message attrs))))
;;       (when (eq name 'error)
;;         (let ((errorlist (gethash filename rjs-overlays nil))
;;               (filebuffer (rjs-really-find-buffer filename)))
;;           (when filebuffer
;;             (when (or (not endoffset) (= endoffset -1))
;;               (with-current-buffer filebuffer
;;                 (save-excursion
;;                   (if startoffset
;;                       (rjs-goto-offset startoffset)
;;                     (progn
;;                       (rjs-goto-line-col line column)
;;                       (setq startoffset (rjs-offset))))
;;                   (let ((rsym (rjs-current-symbol t)))
;;                     (when rsym
;;                       (setq endoffset (+ startoffset (length rsym))))))))

;;             (if (and startoffset endoffset filebuffer)
;;                 (let ((overlay (make-overlay (1+ startoffset)
;;                                              (cond ((= startoffset endoffset) (+ startoffset 2))
;;                                                    (t (1+ endoffset)))
;;                                              filebuffer)))
;;                   (overlay-put overlay 'rjs-error-message message)
;;                   (overlay-put overlay 'rjs-error-severity severity)
;;                   (overlay-put overlay 'rjs-error-start startoffset)
;;                   (overlay-put overlay 'rjs-error-end endoffset)
;;                   (overlay-put overlay 'face (cond ((string= severity "error") 'rjs-errline)
;;                                                    ((string= severity "warning") 'rjs-warnline)
;;                                                    ((string= severity "fixit") 'rjs-fixitline)
;;                                                    (t 'rjs-errline)))
;;                   (if (string= severity "fixit")
;;                       (progn
;;                         (overlay-put overlay 'priority 1)
;;                         (insert (format "%s:%d:%d: fixit: %d-%d: %s\n" filename line column startoffset endoffset message)))
;;                     (insert (format "%s:%d:%d: %s: %s\n" filename line column severity message)))

;;                   (setq errorlist (append errorlist (list overlay)))
;;                   (puthash filename errorlist rjs-overlays)))))))))

;; (defun rjs-parse-overlay-node (node)
;;   (when (listp node)
;;     (let* ((name (car node))
;;            (attrs (cadr node))
;;            (body (cddr node))
;;            (filename (cdr (assq 'name attrs))))
;;       (when (eq name 'file)
;;         (rjs-overlays-remove filename)
;;         (save-excursion
;;           (goto-char (point-min))
;;           (flush-lines (concat filename ":")))
;;         (dolist (it body)
;;           (rjs-parse-overlay-error-node it filename))))))

;; (defvar rjs-last-index nil)
;; (defvar rjs-last-total nil)

;; (defun rjs-modeline-progress ()
;;   (if (and rjs-last-index
;;            rjs-last-total
;;            (> rjs-last-total 0))
;;       ;; (not (= rjs-last-index rjs-last-total)))
;;       (format "Rjs: %d/%d %d%%%% " rjs-last-index rjs-last-total (/ (* rjs-last-index 100) rjs-last-total))
;;     ""))

;; (add-to-list 'global-mode-string '(:eval (rjs-modeline-progress)))
;; (defun rjs-parse-diagnostics (output)
;;   (let ((doc (rjs-parse-xml-string output)) body)
;;     (when doc
;;       ;; (message "GOT XML %s" output)
;;       (cond ((eq (car doc) 'checkstyle)
;;              (setq body (cddr doc))
;;              (while body
;;                (rjs-parse-overlay-node (car body))
;;                (setq body (cdr body))))
;;             ((eq (car doc) 'completions)
;;              (when rjs-completions-enabled
;;                ;; (message "Got completions [%s]" body)
;;                (setq body (car (cddr doc)))
;;                (setq rjs-last-completions
;;                      (cons (cdar (cadr doc)) ;; location attribute
;;                            (list (eval (read body)))))))
;;             ((eq (car doc) 'progress)
;;              (setq body (cadr doc))
;;              (while body
;;                (cond ((eq (caar body) 'index)
;;                       ;; (message "Got index [%s]" (cdar body))
;;                       (setq rjs-last-index (string-to-number (cdar body))))
;;                      ((eq (caar body) 'total)
;;                       (setq rjs-last-total (string-to-number (cdar body))))
;;                      (t (message "Unexpected element %s" (caar body))))
;;                (setq body (cdr body)))
;;              (force-mode-line-update))
;;             ;;             (message "Rjs: %s/%s (%s%%)" index total)))
;;             (t (message "Unexpected root element %s" (car doc)))))))

;; (defun rjs-check-overlay (overlay)
;;   (if (and (not (active-minibuffer-window)) (not cursor-in-echo-area))
;;       (rjs-display-overlay overlay (point))))

;; ;;;###autoload
;; (defun rjs-is-running ()
;;   (interactive)
;;   (with-temp-buffer
;;     (rjs-call-rc "--is-indexing" :noerror t)))

;; (defun rjs-display-overlay (overlay point)
;;   (let ((msg (overlay-get overlay 'rjs-error-message)))
;;     (when (stringp msg)
;;       (if rjs-display-current-error-as-tooltip
;;           (popup-tip msg :point point)) ;; :face 'rjs-warnline)) ;;(overlay-get overlay 'face)))
;;       (if rjs-display-current-error-as-message
;;           (message (concat "Rjs: " msg))))))

;; (defvar rjs-update-current-error-timer nil)

;; (defun rjs-display-current-error ()
;;   (let ((current-overlays (overlays-at (point))))
;;     (setq rjs-update-current-error-timer nil)
;;     (while (and current-overlays (not (rjs-check-overlay (car current-overlays))))
;;       (setq current-overlays (cdr current-overlays)))))

;; (defun rjs-update-current-error ()
;;   (if rjs-update-current-error-timer
;;       (cancel-timer rjs-update-current-error-timer))
;;   (setq rjs-update-current-error-timer
;;         (and (or rjs-display-current-error-as-message
;;                  rjs-display-current-error-as-tooltip)
;;              (get-buffer "*Rjs Diagnostics*")
;;              (run-with-idle-timer
;;               rjs-error-timer-interval
;;               nil
;;               (function rjs-display-current-error)))))

;; (defun rjs-is-rjs-overlay (overlay) (and overlay (overlay-get overlay 'rjs-error-message)))

;; (defun rjs-overlay-comparator (l r)
;;   (< (overlay-start l) (overlay-start r)))

;; (defun rjs-overlays-on-screen ()
;;   (sort (cl-remove-if-not 'rjs-is-rjs-overlay (overlays-in (window-start) (window-end))) #'rjs-overlay-comparator))

;; (defvar rjs-highlighted-overlay nil)

;; ;;;###autoload
;; (defun rjs-cycle-overlays-on-screen ()
;;   (interactive)
;;   (let* ((overlays (rjs-overlays-on-screen))
;;          (idx (and rjs-highlighted-overlay (cl-position rjs-highlighted-overlay overlays)))
;;          (overlay (if (and idx (< (1+ idx) (length overlays)))
;;                       (nth (1+ idx) overlays)
;;                     (car overlays))))
;;     (when overlay
;;       (setq rjs-highlighted-overlay overlay)
;;       (rjs-display-overlay overlay (overlay-start overlay)))))

;; (defun rjs-fix-fixit-overlay (overlay)
;;   (let ((msg (overlay-get overlay 'rjs-error-message))
;;         (severity (overlay-get overlay 'rjs-error-severity))
;;         (insert)
;;         (start (overlay-get overlay 'rjs-error-start))
;;         (end (overlay-get overlay 'rjs-error-end)))
;;     (if (and start end msg (stringp severity) (string= severity "fixit") (string-match "did you mean '\\(.*\\)'\\?$" msg))
;;         (save-excursion
;;           (setq insert (match-string-no-properties 1 msg))
;;           (rjs-goto-offset start)
;;           (delete-char (- end start))
;;           (if insert (insert insert))))))

;; ;;;###autoload
;; (defun rjs-fix-fixit-at-point ()
;;   (interactive)
;;   (let ((current-overlays (overlays-at (point))))
;;     (while (and current-overlays (not (rjs-fix-fixit-overlay (car current-overlays))))
;;       (setq current-overlays (cdr current-overlays)))))

;; (defvar rjs-last-update-current-project-buffer nil)
;; ;;;###autoload
;; (defun rjs-update-current-project ()
;;   (interactive)
;;   (condition-case nil
;;       (when (and (buffer-file-name)
;;                  (not (eq (current-buffer) rjs-last-update-current-project-buffer)))
;;         (setq rjs-last-update-current-project-buffer (current-buffer))
;;         (let* ((rc (rjs-executable-find "rc"))
;;                (path (buffer-file-name))
;;                (arguments (list "-T" path "--silent-query")))
;;           (when rc
;;             (push (concat "--current-file=" path) arguments)
;;             (let ((mapped (if rjs-match-source-file-to-project (apply rjs-match-source-file-to-project (list path)))))
;;               (if (and mapped (length mapped)) (push (concat "--current-file=" mapped) arguments)))
;;             (apply #'start-process "rjs-update-current-project" nil rc arguments))))
;;     (error (message "Got error in rjs-update-current-project"))))

;; (defvar rjs-tracking-timer nil)
;; ;;;###autoload
;; (defun rjs-restart-tracking-timer()
;;   (interactive)
;;   (if rjs-tracking-timer
;;       (cancel-timer rjs-tracking-timer))
;;   (setq rjs-tracking-timer
;;         (and rjs-tracking (string= (buffer-name) rjs-buffer-name)
;;              (run-with-idle-timer
;;               rjs-tracking-timer-interval
;;               nil
;;               (lambda ()
;;                 (if (> (length (window-list)) 1)
;;                     (rjs-show-in-other-window))
;;                 (if rjs-tracking-timer
;;                     (cancel-timer rjs-tracking-timer))
;;                 (setq rjs-tracking-timer nil))))))


(defvar rjs-last-maybe-index-buffer nil)
(defun rjs-maybe-index-buffer ()
  (interactive)
  (when (and (not (minibufferp))
             (not (eq (current-buffer) rjs-last-maybe-index-buffer)))
    (setq rjs-last-maybe-index-buffer (current-buffer))
    (rjs-index-buffer)))

;; ;;;###autoload
(defun rjs-post-command-hook ()
  (interactive)
  (when rjs-enabled
    (rjs-maybe-index-buffer)))

(add-hook 'post-command-hook (function rjs-post-command-hook))
;; ;;(remove-hook 'post-command-hook (function rjs-post-command-hook))

;; ;;;###autoload
;; (defun rjs-stop-diagnostics ()
;;   (interactive)
;;   (if (and rjs-diagnostics-process (not (eq (process-status rjs-diagnostics-process) 'exit)))
;;       (kill-process rjs-diagnostics-process))
;;   (if (get-buffer "*Rjs Diagnostics*")
;;       (kill-buffer "*Rjs Diagnostics*")))

;; ;;;###autoload
;; (defun rjs-clear-diagnostics ()
;;   (interactive)
;;   (when (get-buffer "*Rjs Diagnostics*")
;;     (let (deactivate-mark)
;;       (with-current-buffer "*Rjs Diagnostics*"
;;         (setq buffer-read-only nil)
;;         (goto-char (point-min))
;;         (delete-char (- (point-max) (point-min)))
;;         (setq buffer-read-only t))))
;;   (rjs-clear-diagnostics-overlays))

;; (defun rjs-trim-whitespace (str)
;;   (while (string-match "\\`\n+\\|^\\s-+\\|\\s-+$\\|\n+\\'" str)
;;     (setq str (replace-match "" t t str)))
;;   str)

;; (defconst rjs-diagnostics-process-regx
;;   (regexp-opt '("</checkstyle>"
;;                 "</progress>"
;;                 "</completions>")))

;; (defun rjs-diagnostics-process-filter (process output)
;;   ;; Collect the xml diagnostics into "*Rjs Raw*" until a closing tag is found
;;   (with-current-buffer (get-buffer-create "*Rjs Raw*")
;;     (goto-char (point-max))
;;     (insert output)
;;     (goto-char (point-min))
;;     (let ((matchrx rjs-diagnostics-process-regx)
;;           current endpos)
;;       (while (search-forward-regexp matchrx (point-max) t)
;;         (setq endpos (match-end 0))
;;         (rjs-reset-bookmarks)
;;         (setq current (buffer-substring-no-properties (point-min) endpos))
;;         ;; `rjs-parse-diagnostics' expects us to be in the process buffer
;;         (with-current-buffer (process-buffer process)
;;           (setq buffer-read-only nil)
;;           (rjs-parse-diagnostics (rjs-trim-whitespace current))
;;           (setq buffer-read-only t))
;;         (delete-region (point-min) endpos)))))

;; (defvar rjs-diagnostics-mode-map (make-sparse-keymap))
;; (define-key rjs-diagnostics-mode-map (kbd "q") 'rjs-bury-or-delete)
;; (define-key rjs-diagnostics-mode-map (kbd "c") 'rjs-clear-diagnostics)
;; (define-key rjs-diagnostics-mode-map (kbd "f") 'rjs-apply-fixit-at-point)
;; (set-keymap-parent rjs-diagnostics-mode-map compilation-mode-map)
;; (define-derived-mode rjs-diagnostics-mode compilation-mode
;;   (setq mode-name "rjs-diagnostics")
;;   (use-local-map rjs-diagnostics-mode-map)
;;   (if (buffer-file-name)
;;       (error "Set buffer with file %s read only " (buffer-file-name)))
;;   (setq buffer-read-only t))

;; (defun rjs-init-diagnostics-buffer-and-process (&optional nodirty)
;;   (let ((buf (get-buffer-create "*Rjs Diagnostics*")))
;;     (unless nodirty (rjs-reparse-file))
;;     (with-current-buffer buf
;;       (rjs-diagnostics-mode))
;;     (if (cond ((not rjs-diagnostics-process) t)
;;               ((eq (process-status rjs-diagnostics-process) 'exit) t)
;;               ((eq (process-status rjs-diagnostics-process) 'signal) t)
;;               (t nil))
;;         (let ((process-connection-type nil)) ;; use a pipe
;;           (setq rjs-diagnostics-process (start-process "Rjs Diagnostics" buf (rjs-executable-find "rc") "-m"))
;;           (set-process-filter rjs-diagnostics-process (function rjs-diagnostics-process-filter))
;;           (rjs-clear-diagnostics)))))

;; ;;;###autoload
;; (defun rjs-diagnostics (&optional restart nodirty)
;;   (interactive "P")
;;   (if restart
;;       (rjs-stop-diagnostics))
;;   (rjs-init-diagnostics-buffer-and-process)
;;   (when (called-interactively-p 'any)
;;     (switch-to-buffer-other-window "*Rjs Diagnostics*")
;;     (other-window 1)))

;; (defvar rjs-indexed nil)
;; (defvar rjs-file-managed nil)

;; (defun rjs-buffer-status (&optional buffer)
;;   (let ((path (expand-file-name (or (buffer-file-name buffer) dired-directory default-directory))))
;;     (with-temp-buffer
;;       (rjs-call-rc :path path "-T" path :noerror t :silent-query t)
;;       (goto-char (point-min))
;;       (cond ((looking-at "indexed") 'rjs-indexed)
;;             ((looking-at "managed") 'rjs-file-managed)
;;             (t nil)))))

;; (defun rjs-compilation-flags ()
;;   (interactive)
;;   (let ((path (buffer-file-name)))
;;     (if path
;;         (with-temp-buffer
;;           (rjs-call-rc :path path "--source" path "--compilation-flags-only" "--compilation-flags-split-line")
;;           (split-string (buffer-substring-no-properties (point-min) (point-max)) "\n")))))

;; (defun rjs-is-indexed (&optional buffer)
;;   (equal (rjs-buffer-status buffer) 'rjs-indexed))

;; (defun rjs-has-filemanager (&optional buffer)
;;   (rjs-buffer-status buffer))

;; (defun rjs-handle-results-buffer (&optional noautojump)
;;   (setq rjs-last-request-not-indexed nil)
;;   (rjs-reset-bookmarks)
;;   (cond ((= (point-min) (point-max))
;;          (message "Rjs: No results") nil)
;;         ((= (count-lines (point-min) (point-max)) 1)
;;          (let ((string (buffer-string)))
;;            (bury-buffer)
;;            (rjs-goto-location string)))
;;         (t
;;          (switch-to-buffer-other-window rjs-buffer-name)
;;          (shrink-window-if-larger-than-buffer)
;;          (goto-char (point-max))
;;          (if (= (point-at-bol) (point-max))
;;              (delete-char -1))
;;          (rjs-init-bookmarks)
;;          (rjs-mode)
;;          (when (and rjs-jump-to-first-match (not noautojump))
;;            (rjs-select-other-window)))))

;; (defun rjs-filename-complete (string predicate code)
;;   (let ((complete-list (make-vector 63 0)))
;;     (if (or (string-match "\\(.*\\),[0-9]+" string)
;;             (string-match "\\(.*\\):[0-9]+:[0-9]+" string)
;;             (string-match "\\(.*\\):[0-9]+" string))
;;         (setq string (match-string-no-properties 1 string)))
;;     (with-temp-buffer
;;       (rjs-call-rc :path default-directory "-P" string (if rjs-find-file-case-insensitive "-I"))
;;       (goto-char (point-min))
;;       (if (equal "" string)
;;           (while (not (eobp))
;;             (intern (buffer-substring-no-properties (point-at-bol) (point-at-eol)) complete-list)
;;             (forward-line))
;;         (let ((match-string-no-properties (format  ".*\\(%s.*\\)" string)))
;;           (while (not (eobp))
;;             (if (looking-at match-string-no-properties)
;;                 (intern (buffer-substring-no-properties (match-beginning 1) (match-end 1)) complete-list))
;;             (forward-line))))
;;       (cond ((eq code nil)
;;              (try-completion string complete-list predicate))
;;             ((eq code t)
;;              (all-completions string complete-list predicate))
;;             ((eq code 'lambda)
;;              (if (intern-soft string complete-list) t nil))))))

;; (defvar rjs-taglist-protected nil)
;; (defvar rjs-taglist-locations nil)
;; (define-derived-mode rjs-taglist-mode fundamental-mode
;;   (setq mode-name "rjs-taglist")
;;   (use-local-map rjs-mode-map)
;;   (run-hooks 'rjs-taglist-mode-hook))

;; (defun rjs-close-taglist ()
;;   (interactive)
;;   (unless rjs-taglist-protected
;;     (let ((buf (get-buffer rjs-buffer-name)))
;;       (if (and buf
;;                (not (eq (current-buffer) buf))
;;                (eq (with-current-buffer buf major-mode) 'rjs-taglist-mode))
;;           (let ((windows (window-list)))
;;             (while windows
;;               (when (eq (window-buffer (car windows)) buf)
;;                 (delete-window (car windows))
;;                 (setq windows nil))
;;               (setq windows (cdr windows))))))))

;; (defun rjs-select (&optional other-window remove show)
;;   (interactive "P")
;;   (let* ((line (line-number-at-pos))
;;          (bookmark (format "R_%d" line))
;;          (window (selected-window)))
;;     (cond ((eq major-mode 'rjs-taglist-mode)
;;            (rjs-goto-location (cdr (assoc line rjs-taglist-locations)) nil other-window))
;;           ((and (>= rjs-buffer-bookmarks line)
;;                 (member bookmark (bookmark-all-names)))
;;            (when other-window
;;              (if (= (length (window-list)) 1)
;;                  (split-window))
;;              (other-window 1))
;;            (bookmark-jump bookmark)
;;            (rjs-location-stack-push))
;;           (t (rjs-goto-location (buffer-substring-no-properties (point-at-bol) (point-at-eol)) nil other-window)))
;;     (if remove
;;         (delete-window window)
;;       (if show
;;           (select-window window)))))

;; (defun rjs-select-other-window (&optional not-other-window)
;;   (interactive "P")
;;   (rjs-select (not not-other-window)))

;; (defun rjs-show-in-other-window ()
;;   (interactive)
;;   ;; (message "About to show")
;;   (rjs-select t nil t))

;; (defun rjs-select-and-remove-rjs-buffer ()
;;   (interactive)
;;   (rjs-select t t))

;; (defun rjs-imenu ()
;;   (interactive)
;;   (rjs-save-location)
;;   (let* ((fn (buffer-file-name))
;;          (alternatives (with-temp-buffer
;;                          (rjs-call-rc :path fn :path-filter fn "--imenu" "--list-symbols" "-Y")
;;                          (eval (read (buffer-string)))))
;;          (match (car alternatives)))
;;     (if (> (length alternatives) 1)
;;         (setq match (ido-completing-read "Symbol: " alternatives)))
;;     (if match
;;         (rjs-goto-location (with-temp-buffer (rjs-call-rc :path fn "-F" match :path-filter fn) (buffer-string)))
;;       (message "Rjs: No symbols"))))

;; (defun rjs-show-rjs-buffer ()
;;   (interactive)
;;   (if (get-buffer rjs-buffer-name)
;;       (display-buffer rjs-buffer-name)))

(provide 'rjs)

;;; rjs.el ends here
