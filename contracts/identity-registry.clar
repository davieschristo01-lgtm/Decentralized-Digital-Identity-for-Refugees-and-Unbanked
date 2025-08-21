;; IdentityRegistry Smart Contract
;; This contract manages the registration, update, and revocation of decentralized digital identities (DIDs)
;; for refugees and unbanked individuals. It ensures self-sovereign control, privacy, and immutability.
;; Features include: hashed identity storage, status management, attribute encryption placeholders,
;; revocation mechanisms, and event emissions for auditability.

;; Constants
(define-constant ERR-ALREADY-EXISTS u100) ;; Identity already registered for this user
(define-constant ERR-NOT-FOUND u101) ;; Identity not found
(define-constant ERR-NOT-OWNER u102) ;; Caller is not the owner of the identity
(define-constant ERR-INVALID-HASH u103) ;; Invalid hash length or format
(define-constant ERR-INVALID-STATUS u104) ;; Invalid status transition
(define-constant ERR-REVOKED u105) ;; Identity is revoked
(define-constant ERR-INVALID-ATTRIBUTES u106) ;; Invalid attributes buffer size
(define-constant MAX-ATTRIBUTES-SIZE u1024) ;; Max size for encrypted attributes buffer

;; Data Maps
(define-map identities
  { user: principal }
  {
    id-hash: (buff 32), ;; SHA-256 hash of identity data
    created-at: uint, ;; Block height at creation
    updated-at: (optional uint), ;; Block height at last update
    status: (string-ascii 20), ;; e.g., "pending", "verified", "revoked"
    encrypted-attributes: (optional (buff 1024)), ;; Optional encrypted user data (off-chain decrypted)
    revocation-reason: (optional (string-utf8 200)) ;; Reason for revocation, if applicable
  }
)

;; Private Functions
(define-private (is-valid-hash (hash (buff 32)))
  ;; Simple validation: ensure it's exactly 32 bytes
  (is-eq (len hash) u32)
)

(define-private (emit-event (event-name (string-ascii 50)) (details (tuple (key (string-ascii 50)) (value (string-utf8 200)))))
  ;; Emit a print event for logging/audit purposes
  (print { event: event-name, details: details })
)

;; Public Functions
(define-public (register-identity (id-hash (buff 32)) (encrypted-attributes (optional (buff 1024))))
  (let
    (
      (caller tx-sender)
      (existing (map-get? identities { user: caller }))
    )
    (asserts! (is-none existing) (err ERR-ALREADY-EXISTS))
    (asserts! (is-valid-hash id-hash) (err ERR-INVALID-HASH))
    (match encrypted-attributes attrs
      (asserts! (<= (len attrs) MAX-ATTRIBUTES-SIZE) (err ERR-INVALID-ATTRIBUTES))
      true ;; No attributes is fine
    )
    (map-set identities
      { user: caller }
      {
        id-hash: id-hash,
        created-at: block-height,
        updated-at: none,
        status: "pending",
        encrypted-attributes: encrypted-attributes,
        revocation-reason: none
      }
    )
    (emit-event "identity-registered" { key: "user", value: (principal->string caller) })
    (ok true)
  )
)

(define-public (update-identity (new-id-hash (buff 32)) (new-encrypted-attributes (optional (buff 1024))))
  (let
    (
      (caller tx-sender)
      (existing (map-get? identities { user: caller }))
    )
    (asserts! (is-some existing) (err ERR-NOT-FOUND))
    (let ((identity (unwrap-panic existing)))
      (asserts! (is-eq (get status identity) "pending") (err ERR-INVALID-STATUS)) ;; Only update if pending
      (asserts! (is-valid-hash new-id-hash) (err ERR-INVALID-HASH))
      (match new-encrypted-attributes attrs
        (asserts! (<= (len attrs) MAX-ATTRIBUTES-SIZE) (err ERR-INVALID-ATTRIBUTES))
        true
      )
      (map-set identities
        { user: caller }
        (merge identity
          {
            id-hash: new-id-hash,
            updated-at: (some block-height),
            encrypted-attributes: new-encrypted-attributes
          }
        )
      )
      (emit-event "identity-updated" { key: "user", value: (principal->string caller) })
      (ok true)
    )
  )
)

(define-public (revoke-identity (reason (string-utf8 200)))
  (let
    (
      (caller tx-sender)
      (existing (map-get? identities { user: caller }))
    )
    (asserts! (is-some existing) (err ERR-NOT-FOUND))
    (let ((identity (unwrap-panic existing)))
      (asserts! (not (is-eq (get status identity) "revoked")) (err ERR-REVOKED))
      (map-set identities
        { user: caller }
        (merge identity
          {
            status: "revoked",
            updated-at: (some block-height),
            revocation-reason: (some reason)
          }
        )
      )
      (emit-event "identity-revoked" { key: "user", value: (principal->string caller) })
      (ok true)
    )
  )
)

;; Read-Only Functions
(define-read-only (get-identity (user principal))
  (map-get? identities { user: user })
)

(define-read-only (is-identity-active (user principal))
  (let ((identity (map-get? identities { user: user })))
    (if (is-some identity)
      (is-eq (get status (unwrap-panic identity)) "verified")
      false
    )
  )
)

(define-read-only (get-identity-status (user principal))
  (let ((identity (map-get? identities { user: user })))
    (match identity id (get status id) none)
  )
)

(define-read-only (get-creation-time (user principal))
  (let ((identity (map-get? identities { user: user })))
    (match identity id (get created-at id) u0)
  )
)

(define-read-only (get-update-time (user principal))
  (let ((identity (map-get? identities { user: user })))
    (match identity id (default-to u0 (get updated-at id)) u0)
  )
)

(define-read-only (get-revocation-reason (user principal))
  (let ((identity (map-get? identities { user: user })))
    (match identity id (get revocation-reason id) none)
  )
)

;; Additional Utility Functions
(define-public (set-identity-status (user principal) (new-status (string-ascii 20)))
  ;; This would typically be called by VerificationManager, but for sophistication, add owner-only for now
  (let
    (
      (caller tx-sender)
      (existing (map-get? identities { user: user }))
    )
    (asserts! (is-some existing) (err ERR-NOT-FOUND))
    (let ((identity (unwrap-panic existing)))
      (asserts! (is-eq caller user) (err ERR-NOT-OWNER)) ;; Only owner can set status (extend later)
      (asserts! (or (is-eq new-status "pending") (is-eq new-status "verified")) (err ERR-INVALID-STATUS))
      (asserts! (not (is-eq (get status identity) "revoked")) (err ERR-REVOKED))
      (map-set identities
        { user: user }
        (merge identity
          {
            status: new-status,
            updated-at: (some block-height)
          }
        )
      )
      (emit-event "status-updated" { key: "user", value: (principal->string user) })
      (ok true)
    )
  )
)

;; Helper function to convert principal to string (for events)
(define-private (principal->string (p principal))
  (unwrap-panic (principal-to-string? p))
)
