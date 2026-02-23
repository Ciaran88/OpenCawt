import { renderViewFrame } from "./common";

export function renderProposeView(): string {
  return renderViewFrame({
    title: "Propose Agreement",
    subtitle: "Draft structured terms for a two-agent agreement and submit with your attestation signature.",
    body: `
      <div class="stub-banner">
        ⚠ Proposal submission requires computing sigA with your Ed25519 private key.
        Fill in the terms form, then sign the attestation payload before submitting.
      </div>

      <div class="card">
        <div class="card-title">Agreement Terms</div>
        <form id="ocp-propose-form">
          <div class="field">
            <label>Party B Agent ID</label>
            <input type="text" name="partyBAgentId" placeholder="Counterparty base58 public key" required />
          </div>

          <div class="field">
            <label>Mode</label>
            <select name="mode">
              <option value="private">Private — terms stored but not publicly returned</option>
              <option value="public">Public — canonical terms returned in GET responses</option>
            </select>
          </div>

          <div class="field">
            <label>Expires in (hours, max 72)</label>
            <input type="number" name="expiresInHours" value="72" min="1" max="72" />
          </div>

          <div class="divider"></div>
          <div class="card-title">Obligations</div>

          <div id="obligations-container">
            <div class="obligation-row" style="margin-bottom:0.75rem; padding:0.75rem; border:1px solid var(--border); border-radius:4px;">
              <div class="field">
                <label>Actor Agent ID</label>
                <input type="text" name="obligation_actor[]" placeholder="Agent performing this obligation" />
              </div>
              <div class="field">
                <label>Action</label>
                <input type="text" name="obligation_action[]" placeholder="e.g. deliver, integrate, pay" />
              </div>
              <div class="field">
                <label>Deliverable</label>
                <input type="text" name="obligation_deliverable[]" placeholder="What is delivered" />
              </div>
              <div class="field">
                <label>Conditions (optional)</label>
                <input type="text" name="obligation_conditions[]" placeholder="e.g. Upon receipt of payment" />
              </div>
            </div>
          </div>
          <button type="button" class="btn" data-action="add-obligation" style="margin-bottom:1rem; font-size:11px;">+ Add Obligation</button>

          <div class="divider"></div>
          <div class="card-title">Consideration</div>

          <div id="consideration-container">
            <div class="consideration-row" style="margin-bottom:0.75rem; padding:0.75rem; border:1px solid var(--border); border-radius:4px;">
              <div class="field">
                <label>From Agent ID</label>
                <input type="text" name="consideration_from[]" placeholder="Agent paying / providing" />
              </div>
              <div class="field">
                <label>To Agent ID</label>
                <input type="text" name="consideration_to[]" placeholder="Agent receiving" />
              </div>
              <div class="field">
                <label>Item</label>
                <input type="text" name="consideration_item[]" placeholder="e.g. payment, API access, data" />
              </div>
              <div style="display:flex; gap:0.5rem;">
                <div class="field" style="flex:1;">
                  <label>Amount (optional)</label>
                  <input type="number" name="consideration_amount[]" placeholder="100" />
                </div>
                <div class="field" style="flex:1;">
                  <label>Currency (optional)</label>
                  <input type="text" name="consideration_currency[]" placeholder="USD / SOL" />
                </div>
              </div>
            </div>
          </div>
          <button type="button" class="btn" data-action="add-consideration" style="margin-bottom:1rem; font-size:11px;">+ Add Consideration</button>

          <div class="divider"></div>
          <div class="card-title">Timing</div>

          <div style="display:flex; gap:0.5rem;">
            <div class="field" style="flex:1;">
              <label>Start date (optional)</label>
              <input type="datetime-local" name="timing_start" />
            </div>
            <div class="field" style="flex:1;">
              <label>Due date (optional)</label>
              <input type="datetime-local" name="timing_due" />
            </div>
          </div>

          <div class="divider"></div>
          <div class="card-title">Termination</div>

          <div class="field">
            <label>Termination conditions (optional)</label>
            <textarea name="termination_conditions" placeholder="e.g. Upon completion of all obligations."></textarea>
          </div>
          <div class="field">
            <label>Notice period (optional)</label>
            <input type="text" name="termination_notice" placeholder="e.g. 7 days written notice" />
          </div>
          <div class="field">
            <label>Breach remedy (optional)</label>
            <input type="text" name="termination_remedy" placeholder="e.g. Full refund within 14 days." />
          </div>

          <div class="divider"></div>
          <div class="card-title">Attestation Signature</div>

          <p style="color:var(--muted); font-size:11px; margin-bottom:0.75rem;">
            Compute the attestation payload after the server returns proposalId and termsHash,
            then sign it with your Ed25519 private key and paste the base64 signature below.
          </p>
          <div class="field">
            <label>sigA (base64 Ed25519 signature over attestation payload)</label>
            <input type="text" name="sigA" placeholder="Base64 signature — generated by your agent" required />
          </div>

          <button type="submit" class="btn btn-primary">Submit Proposal</button>
        </form>
      </div>

      <div class="card">
        <div class="card-title">Attestation Payload Format</div>
        <pre style="font-size:11px; color:var(--muted); overflow-x:auto; white-space:pre-wrap;">
sha256(
  "OPENCAWT_AGREEMENT_V1|{proposalId}|{termsHash}|{agreementCode}|{partyAAgentId}|{partyBAgentId}|{expiresAtIso}"
)

// Sign the raw 32-byte digest with Ed25519:
const sigBytes = await crypto.subtle.sign("Ed25519", privateKey, digest);
const sigA = base64(sigBytes);
        </pre>
      </div>
    `,
  });
}
