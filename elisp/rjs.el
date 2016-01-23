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

(require 'bookmark)
(require 'ido)
(require 'thingatpt)

(defgroup rjs nil
  "Minor mode for rjs."
  :group 'tools
  :prefix "rjs-")

(if (or (> emacs-major-version 24)
        (and (= emacs-major-version 24)
             (>= emacs-minor-version 3)))
    (require 'cl-lib)
  (eval-when-compile
    (require 'cl)))

(defvar rjs-last-buffer nil)
(defvar rjs-process nil)
(defvar rjs-mode-hook nil)
(defface rjs-path nil "Path" :group 'rjs)
(defface rjs-context nil "Context" :group 'rjs)
(defvar rjs-path-face 'rjs-path "Path part")
(defvar rjs-context-face 'rjs-context "Context part")
(defconst rjs-buffer-name "*RJS*")
(defconst rjs-process-buffer-name "*RJS Process*")
(defvar rjs-buffer-bookmarks 0)

(defcustom rjs-enabled t
  "Whether rjs is enabled. We try to do nothing when it's not"
  :group 'rjs
  :type 'boolean)

(defcustom rjs-jump-to-first-match t
  "If t, jump to first match"
  :group 'rjs
  :type 'boolean)

(defcustom rjs-path nil
  "Path to rjs executables"
  :group 'rjs
  :type 'string)

(defcustom rjs-max-bookmark-count 100
  "How many bookmarks to keep in stack"
  :group 'rjs
  :type 'integer)

(defcustom rjs-log-enabled t
  "If t, log rjs commands and responses"
  :group 'rjs
  :type 'boolean)

(defcustom rjs-log-file nil
  "Set to file name to log to"
  :group 'rjs
  :type 'string)

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
  (let ((buf (get-buffer-create (or name rjs-buffer-name))))
    (with-current-buffer buf
      (setq buffer-read-only nil)
      (erase-buffer)
      buf)))

;;;###autoload
(defun rjs-bury-or-delete ()
  (interactive)
  (if (> (length (window-list)) 1)
      (delete-window)
    (bury-buffer)))

(defun rjs-buffer ()
  (interactive)
  (let ((buf (get-buffer rjs-buffer-name)))
    (if buf
        (switch-to-buffer buf))))

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

(defun rjs-current-token ()
  (save-excursion
    (when (looking-at "[0-9A-Za-z_$]")
      (while (and (> (point) (point-min)) (looking-at "[0-9A-Za-z_$]"))
        (backward-char))
      (when (not (looking-at "[0-9A-Za-z_$]"))
        (forward-char))
      (let ((start (point)))
        (while (looking-at "[0-9A-Za-z_$]")
          (forward-char))
        (buffer-substring-no-properties start (point))))))

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
(defun rjs-next-match ()
  (interactive)
  (rjs-next-prev-match 'next))
;;;###autoload
(defun rjs-previous-match ()
  (interactive)
  (rjs-next-prev-match 'prev))

(defun rjs-next-prev-suitable-match (direction)
  (save-excursion
    (if (eq direction 'next)
        (goto-char (point-at-bol 2))
      (goto-char (point-at-bol 0)))
    (beginning-of-line)
    (when (looking-at "$")
      (when (eq direction 'next)
        (goto-char (point-min))
        (beginning-of-line)))
    (point)))

(defun rjs-next-prev-match (direction)
  (if (get-buffer rjs-buffer-name)
      (let (target
            (win (get-buffer-window rjs-buffer-name)))
        (if win
            (select-window win))
        (set-buffer rjs-buffer-name)
        (when (> (count-lines (point-max) (point-min)) 1)
          (cond ((and (= (point-at-bol) (point-min)) (eq direction 'prev))
                 (goto-char (point-max))
                 (beginning-of-line)
                 (while (looking-at "$")
                   (goto-char (1- (point))))
                 (message "%s Wrapped" rjs-buffer-name))
                ((and (= (point-at-eol) (point-max)) (eq direction 'next))
                 (goto-char (point-min))
                 (setq target (point-min))
                 (message "%s Wrapped" rjs-buffer-name))
                (t
                 (goto-char (rjs-next-prev-suitable-match direction))))
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

(defun rjs-is-running()
  (and rjs-process (eq (process-status rjs-process) 'run)))

(defun rjs-clear-client-buffer ()
  (interactive)
  (let ((buf (get-buffer rjs-buffer-name)))
    (if buf
        (with-current-buffer buf
          (erase-buffer)))))

(defun rjs-handle-results (locations)
  (let ((buf (rjs-buffer)))
    (switch-to-buffer buf)
    (mapc (lambda (item)
            (unless (= (point) (point-min))
              (insert "\n"))
            (if (cdr item)
                (insert (car item) "\t" (cdr item))
              (insert (car item)))) locations)
    (rjs-init-bookmarks)
    (rjs-mode)
    (when rjs-jump-to-first-match
      (rjs-select-other-window))))

(defun rjsd-handle-message (msg)
  (cond ((null msg))
        ((eq (car msg) 'notfound)
         (message "RJS: No symbol found"))
        ((eq (car msg) 'notindexed)
         (message "RJS: %s is not indexed" (cdr msg)))
        ((eq (car msg) 'location)
         (rjs-location-stack-push)
         (rjs-goto-location :location (cdr msg)))
        ((eq (car msg) 'locations)
         (rjs-handle-results (cdr msg)))
        (t)))

(defun rjsd-parse-messages ()
  (let ((messages))
    (while (and (goto-char (point-min))
                (search-forward "\n" (point-max) t))
      (let* ((pos (1- (point)))
             (data (and (> (1- pos) (point-min))
                        (save-restriction
                          (narrow-to-region (point-min) pos)
                          (save-excursion
                            (goto-char (point-min))
                            (if (looking-at "(")
                                (condition-case nil
                                    (eval (read (current-buffer)))
                                  (error
                                   (message "****** Got Parse Error ******")
                                   (setq rjsd-filter-errors
                                         (append rjsd-filter-errors
                                                 (list (buffer-substring-no-properties (point-min) (point-max)))))))
                              (message "RJS Output: [%s]" (buffer-substring-no-properties (point-min) (point-max)))
                              nil))))))
        (forward-char 1)
        (delete-region (point-min) (point))
        (setq messages (append messages (list data)))))
    (mapc 'rjsd-handle-message messages)))

(defvar rjsd-filter-errors nil)
(defun rjsd-filter (process output)
  (save-excursion
    (let ((buffer (process-buffer process))
          (old (current-buffer)))
      (set-buffer buffer)
      (goto-char (point-max))
      (insert output)

      (rjsd-parse-messages))))

(defun* rjs-invoke (&rest arguments &key noerror (output (current-buffer)) &allow-other-keys)
  (setq arguments (cl-remove-if '(lambda (arg) (not arg)) arguments))
  (setq arguments (rjs-remove-keyword-params arguments))

  (let ((buf (rjs-get-buffer rjs-process-buffer-name)))
    (unless (and rjs-process (eq (process-status rjs-process) 'run))
      (let ((exec (rjs-executable-find "rjsd")) proc
            (args (list "--silent" "-o" "elisp")))
        (if (not exec)
            (if (not noerror)
                (error "Can't find rjsd"))
          (if (stringp rjs-log-file)
              (setq args (append args (list "-l" rjs-log-file))))
          (rjs-log (concat exec " " (combine-and-quote-strings args)))
          (setq rjs-process (apply #'start-process rjs-process-buffer-name buf exec args))
          (set-process-filter rjs-process (function rjsd-filter)))))
    (unless buf
      (error (format "%s buffer is gone" rjs-process-buffer-name)))
    (rjs-log (concat (rjs-executable-find "rjsd") " " (combine-and-quote-strings arguments)))
    (process-send-string rjs-process (concat (combine-and-quote-strings arguments) "\n"))))

(defun rjs-goto-line-col (line column)
  (let ((old (point)))
    (push-mark nil t)
    (goto-char (point-min))
    (condition-case nil
        (progn
          (forward-line (1- line))
          (forward-char (1- column))
          t)
      (error
       (goto-char old)
       nil))))

(defun* rjs-goto-location (&key location no-location-stack other-window)
  (when (and (> (length location) 0)
             (string-match "\\(.*\\),\\([0-9]+\\)" location))
    (let ((offset (string-to-number (match-string-no-properties 2 location))))
      (rjs-find-file-or-buffer (match-string-no-properties 1 location) other-window)
      (rjs-goto-offset offset)
      (unless no-location-stack
        (rjs-location-stack-push))
      t)))

(defun rjs-current-location ()
  (if (buffer-file-name)
      (concat (buffer-file-name) "," (number-to-string (1- (point))))))

(defun rjs-find-symbol-at-point ()
  (interactive)
  (let ((loc (rjs-current-location)))
    (unless loc
      (error "RJS: Buffer is not visiting a file"))
    (rjs-invoke "-f" loc)))

(defun rjs-find-references-at-point ()
  (interactive)
  (let ((loc (rjs-current-location)))
    (unless loc
      (error "RJS: Buffer is not visiting a file"))
    (rjs-invoke "-r" loc)))


(defun rjs-symbolname-completion-get (string)
  (with-temp-buffer
    (rjs-invoke "-S" string)
    ;; (when rjs-rc-log-enabled
    ;;   (rjs-log (buffer-string)))
    (eval (read (buffer-string)))))

(defun rjs-symbolname-completion-exactmatch (string)
  (with-temp-buffer
    (rjs-invoke "-N" "-F" string)
    (> (point-max) (point-min))))

(defun rjs-symbolname-complete (string predicate code)
  ;; (message "CALLED %s %s %s"
  ;;          string predicate
  ;;          (cond ((eq code nil) "nil")
  ;;                ((eq code t) "t")
  ;;                ((eq code 'lambda) "lambda")))

  (cond ((null code)
         (let* ((alternatives (rjs-symbolname-completion-get string))
                (attempt (try-completion string alternatives predicate)))
           ;; (message "%s %d %d %s %s" string (length alternatives)
           ;;          (if rjs-wildcard-symbol-names 1 0)
           ;;          attempt
           ;;          (and (string-match '\\*' string) "yes"))

           ;; (if (and rjs-wildcard-symbol-names
           ;;          (not attempt)
           ;;          (> (length alternatives) 0)
           ;;          (string-match "\\*" string))
           ;;     (progn
           ;;       (message "RETURNING STRING")
           ;;       string)
           ;;   attempt)))
           attempt))
        ((eq code t)
         (rjs-symbolname-completion-get string))
        ((eq code 'lambda)
         (rjs-symbolname-completion-exactmatch string))
        (t nil)))

(defun rjs-remove-last-if-duplicated (seq) ;; destroys seq
  (let ((newitem (car (last seq))))
    (when (> (length (member newitem seq)) 1)
      (nbutlast seq 1))
    seq))


(defvar rjs-symbol-name-history nil)
(defun rjs-find-symbol ()
  (interactive)
  (let* ((token (if mark-active
                    (buffer-substring-no-properties (region-beginning) (region-end))
                  (rjs-current-token)))
         (prompt (if token
                     (format "Symbol (default: %s): " token)
                   "Symbol: "))
         (input (if (fboundp 'completing-read-default)
                    (completing-read-default prompt (function rjs-symbolname-complete) nil nil nil 'rjs-symbol-name-history)
                  (completing-read prompt (function rjs-symbolname-complete) nil nil nil 'rjs-symbol-name-history))))
    (setq rjs-symbol-name-history (rjs-remove-last-if-duplicated rjs-symbol-name-history))
    (when (equal input "")
      (setq input token))
    (unless (equal input "")
      (rjs-invoke "-F" input))))

(defun rjs-cursor-info ()
  (interactive)
  (let ((loc (rjs-current-location)))
    (unless loc
      (error "RJS: Buffer is not visiting a file"))
    (rjs-invoke "-u" loc)))
;; (with-temp-buffer
;;   (if (rjs-invoke "-u" loc)
;;       (message "%s" (buffer-substring-no-properties (point-min) (point-max)))))))

(defvar rjs-is-js-file-function nil)
(defun rjs-is-js-file (&optional file-or-buffer)
  (cond ((bufferp file-or-buffer)
         (setq file-or-buffer (buffer-file-name file-or-buffer)))
        ((stringp file-or-buffer))
        (t (setq file-or-buffer (buffer-file-name))))
  (if file-or-buffer
      (if (functionp rjs-is-js-file-function)
          (funcall rjs-is-js-file-function file-or-buffer)
        (let ((suffix (file-name-extension file-or-buffer)))
          (or (and suffix (string= "js" (downcase suffix)))
              (eq major-mode 'js2-mode)
              (eq major-mode 'javascript-mode))))))


;;;###autoload
(defun rjs-index-buffer (&optional buffer-or-name)
  (interactive)
  (let ((bufname (cond ((stringp buffer-or-name) buffer-or-name)
                       ((bufferp buffer-or-name) (buffer-file-name buffer-or-name))
                       (t buffer-file-name))))
    (if (and bufname (rjs-is-js-file bufname))
        (rjs-invoke "--index" bufname :noerror t))))

(defun rjs-buffer-is-multibyte ()
  (string-match "\\butf\\b" (symbol-name buffer-file-coding-system)))

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

(defun rjs-log (log)
  (if rjs-log-enabled
      (with-current-buffer (get-buffer-create "*RJS Log*")
        (goto-char (point-max))
        (setq buffer-read-only nil)
        (insert "**********************************\n" log "\n")
        (setq buffer-read-only t))))

(defun rjs-find-file-or-buffer (file-or-buffer &optional other-window)
  (if (file-exists-p file-or-buffer)
      (if other-window
          (find-file-other-window file-or-buffer)
        (find-file file-or-buffer))
    (let ((buf (get-buffer file-or-buffer)))
      (cond ((not buf) (message "No buffer named %s" file-or-buffer))
            (other-window (switch-to-buffer-other-window file-or-buffer))
            (t (switch-to-buffer file-or-buffer))))))

(defvar rjs-location-stack-index 0)
(defvar rjs-location-stack nil)
;;(setq rjs-location-stack-index 0)
;;(setq rjs-location-stack nil)

(defun rjs-location-stack-push (&optional location)
  (unless location
    (setq location (rjs-current-location)))
  (while (> rjs-location-stack-index 0)
    (decf rjs-location-stack-index)
    (pop rjs-location-stack))
  (unless (string= location (nth 0 rjs-location-stack))
    (push location rjs-location-stack)
    (if (> (length rjs-location-stack) rjs-max-bookmark-count)
        (nbutlast rjs-location-stack (- (length rjs-location-stack) rjs-max-bookmark-count)))))

;;;###autoload
(defun rjs-location-stack-jump (by)
  (interactive)
  (let ((instack (nth rjs-location-stack-index rjs-location-stack))
        (cur (rjs-current-location)))
    (if (not (string= instack cur))
        (rjs-goto-location :location instack :no-location-stack t)
      (let ((target (+ rjs-location-stack-index by)))
        (when (and (>= target 0) (< target (length rjs-location-stack)))
          (setq rjs-location-stack-index target)
          (rjs-goto-location :location (nth rjs-location-stack-index rjs-location-stack) :no-location-stack t))))))

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

(defun* rjs-handle-results-buffer (&key noautojump)
  (rjs-reset-bookmarks)
  (cond ((= (point-min) (point-max))
         (message "RJS: No results") nil)
        ((= (count-lines (point-min) (point-max)) 1)
         (let ((string (buffer-string)))
           (bury-buffer)
           (rjs-goto-location :location string)))
        (t
         (switch-to-buffer-other-window rjs-buffer-name)
         (shrink-window-if-larger-than-buffer)
         (goto-char (point-max))
         (if (= (point-at-bol) (point-max))
             (delete-char -1))
         (rjs-init-bookmarks)
         (rjs-mode)
         (when (and rjs-jump-to-first-match (not noautojump))
           (rjs-select-other-window)))))

(defun* rjs-select (&key other-window remove show)
  (interactive "P")
  (let* ((line (line-number-at-pos))
         (bookmark (format "R_%d" line))
         (window (selected-window)))
    (cond ((and (>= rjs-buffer-bookmarks line)
                (member bookmark (bookmark-all-names)))
           (when other-window
             (if (= (length (window-list)) 1)
                 (split-window))
             (other-window 1))
           (bookmark-jump bookmark)
           (rjs-location-stack-push))
          (t (rjs-goto-location :location (buffer-substring-no-properties (point-at-bol) (point-at-eol)) :other-window other-window)))
    (if remove
        (delete-window window)
      (if show
          (select-window window)))))

(defun rjs-select-other-window (&optional not-other-window)
  (interactive "P")
  (rjs-select :other-window (not not-other-window)))

(defun rjs-select-and-remove-rjs-buffer ()
  (interactive)
  (rjs-select :other-window t :remove t))

(defun rjs-copy-and-print-current-location()
  (interactive)
  (let ((loc (rjs-current-location)))
    (if (not loc)
        (message "No current location!")
      (kill-new loc)
      (message loc))))

(provide 'rjs)

;;; rjs.el ends here
