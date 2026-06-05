#![no_std]
#![no_main]

use ckb_std::{default_alloc, entry};

// entry! MUST come before default_alloc!
// It sets up _start, panic_handler, and extern crate alloc
entry!(program_entry);
default_alloc!();

use ckb_std::{
    ckb_constants::Source,
    ckb_types::prelude::*,
    debug,
    high_level::{load_script, load_tx_hash, load_witness_args},
};

use fips204::ml_dsa_65;
use fips204::traits::{SerDes, Verifier};

// ckb_hash is a dependency of ckb-gen-types, available via calc-hash feature
// It re-exports Blake2b and Blake2bBuilder from blake2b_ref in contract mode
use ckb_std::ckb_types::prelude::Pack;

const CKB_PERSONALIZATION: &[u8] = b"ckb-default-hash";

const ERR_INVALID_ARGS_LENGTH:    i8 = 1;
const ERR_INVALID_WITNESS:        i8 = 2;
const ERR_PUBKEY_HASH_MISMATCH:   i8 = 3;
const ERR_INVALID_PUBKEY:         i8 = 4;
const ERR_INVALID_SIGNATURE:      i8 = 5;
const ERR_SIGNATURE_VERIFICATION: i8 = 6;

const PUBKEY_BYTES: usize = ml_dsa_65::PK_LEN;
const SIG_BYTES:   usize = ml_dsa_65::SIG_LEN;

fn blake2b_256(data: &[u8]) -> [u8; 32] {
    use blake2b_ref::Blake2bBuilder;
    let mut hasher = Blake2bBuilder::new(32)
        .personal(CKB_PERSONALIZATION)
        .build();
    hasher.update(data);
    let mut result = [0u8; 32];
    hasher.finalize(&mut result);
    result
}

fn program_entry() -> i8 {
    debug!("dilithium-lock: starting");

    //  Load args — expected to be 32-byte blake2b hash of pubkey
    let script = match load_script() {
        Ok(s) => s,
        Err(_) => return ERR_INVALID_ARGS_LENGTH,
    };
    let args = script.args();
    let args_raw = args.raw_data();
    if args_raw.len() != 32 {
        return ERR_INVALID_ARGS_LENGTH;
    }

    //  Load tx hash
    let tx_hash = match load_tx_hash() {
        Ok(h) => h,
        Err(_) => return ERR_INVALID_WITNESS,
    };

    //  Load witness
    let witness_args = match load_witness_args(0, Source::GroupInput) {
        Ok(w) => w,
        Err(_) => return ERR_INVALID_WITNESS,
    };
    let lock_field = match witness_args.lock().to_opt() {
        Some(l) => l.raw_data(),
        None => return ERR_INVALID_WITNESS,
    };

    // Parse witness into pubkey + sig
    let (raw_pubkey, raw_sig) = match parse_witness(&lock_field) {
        Some(pair) => pair,
        None => return ERR_INVALID_WITNESS,
    };

    //  Verify pubkey hash matches args
    let pubkey_hash = blake2b_256(raw_pubkey);
    if pubkey_hash != args_raw.as_ref() {
        debug!("dilithium-lock: pubkey hash mismatch");
        return ERR_PUBKEY_HASH_MISMATCH;
    }

    //  Decode public key
    if raw_pubkey.len() != PUBKEY_BYTES {
        return ERR_INVALID_PUBKEY;
    }
    let pubkey_array: [u8; PUBKEY_BYTES] = match raw_pubkey.try_into() {
        Ok(a) => a,
        Err(_) => return ERR_INVALID_PUBKEY,
    };
    let public_key = match ml_dsa_65::PublicKey::try_from_bytes(pubkey_array) {
        Ok(pk) => pk,
        Err(_) => return ERR_INVALID_PUBKEY,
    };

    //  Decode signature — in fips204 v0.4 it's a raw byte array
    if raw_sig.len() != SIG_BYTES {
        return ERR_INVALID_SIGNATURE;
    }
    let sig_array: [u8; SIG_BYTES] = match raw_sig.try_into() {
        Ok(a) => a,
        Err(_) => return ERR_INVALID_SIGNATURE,
    };

    //  Verify signature
    if !public_key.verify(&tx_hash, &sig_array, &[]) {
        debug!("dilithium-lock: verification failed");
        return ERR_SIGNATURE_VERIFICATION;
    }

    debug!("dilithium-lock: OK");
    0
}

fn parse_witness(data: &[u8]) -> Option<(&[u8], &[u8])> {
    if data.len() < 8 { return None; }
    let pubkey_len = u32::from_le_bytes(data[0..4].try_into().ok()?) as usize;
    let pubkey_end = 4 + pubkey_len;
    if data.len() < pubkey_end + 4 { return None; }
    let raw_pubkey = &data[4..pubkey_end];
    let sig_len = u32::from_le_bytes(
        data[pubkey_end..pubkey_end+4].try_into().ok()?
    ) as usize;
    let sig_end = pubkey_end + 4 + sig_len;
    if data.len() < sig_end { return None; }
    Some((raw_pubkey, &data[pubkey_end+4..sig_end]))
}

// https://testnet.explorer.nervos.org/transaction/0x4572a31a4b6a3d86396c7f344c5d7d8a51b288c8962bad52179a1724e177ef6b