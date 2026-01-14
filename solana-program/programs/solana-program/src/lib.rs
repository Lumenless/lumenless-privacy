use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
    },
};

declare_id!("LUMPd26Acz4wqS8EBuoxPN2zhwCUF4npbkrqhLbM9AL");

/// Seed prefix for user vault PDAs
pub const VAULT_SEED: &[u8] = b"vault";

/// SNS Name Service Program ID
pub const NAME_SERVICE_PROGRAM_ID: Pubkey = pubkey!("namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX");

/// SNS Records V2 Program ID (correct mainnet address)
pub const SNS_RECORDS_PROGRAM_ID: Pubkey = pubkey!("HP3D4D1ZCmohQGFVms2SS4LCANgJyksBf5s1F77FuFjZ");

/// Record V2 discriminator/class for key derivation
pub const RECORD_V2_CLASS: u8 = 2;

#[program]
pub mod solana_program {
    use super::*;

    /// Initialize a vault for a user
    /// The vault PDA is derived from the user's public key
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.bump = ctx.bumps.vault;
        vault.domains_count = 0;

        msg!("Vault initialized for user: {}", vault.owner);
        Ok(())
    }

    /// Deposit an SNS domain into the user's vault
    /// The domain NFT is transferred to a token account owned by the vault PDA
    pub fn deposit_domain(ctx: Context<DepositDomain>) -> Result<()> {
        // Transfer the SNS domain (NFT) from user to vault's token account
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
            mint: ctx.accounts.domain_mint.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_context = CpiContext::new(cpi_program, cpi_accounts);

        // SNS domains are NFTs with 0 decimals and amount of 1
        transfer_checked(cpi_context, 1, 0)?;

        let vault = &mut ctx.accounts.vault;
        vault.domains_count = vault.domains_count.checked_add(1).unwrap();

        msg!(
            "Domain {} deposited to vault. Total domains: {}",
            ctx.accounts.domain_mint.key(),
            vault.domains_count
        );
        Ok(())
    }

    /// Withdraw an SNS domain from the user's vault
    /// Only the original owner can withdraw their domains
    pub fn withdraw_domain(ctx: Context<WithdrawDomain>) -> Result<()> {
        let vault = &ctx.accounts.vault;

        // Verify the vault has domains
        require!(vault.domains_count > 0, VaultError::NoDomains);

        // Build PDA signer seeds
        let owner_key = ctx.accounts.owner.key();
        let bump = vault.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, owner_key.as_ref(), &[bump]]];

        // Transfer the SNS domain back to user
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.domain_mint.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_context = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

        // SNS domains are NFTs with 0 decimals and amount of 1
        transfer_checked(cpi_context, 1, 0)?;

        // Update domains count
        let vault = &mut ctx.accounts.vault;
        vault.domains_count = vault.domains_count.checked_sub(1).unwrap();

        msg!(
            "Domain {} withdrawn from vault. Remaining domains: {}",
            ctx.accounts.domain_mint.key(),
            vault.domains_count
        );
        Ok(())
    }

    /// Deposit an unwrapped SNS domain into the user's vault
    /// Transfers name registry ownership to the vault PDA
    pub fn deposit_unwrapped_domain(ctx: Context<DepositUnwrappedDomain>) -> Result<()> {
        let vault = &ctx.accounts.vault;
        
        // Build instruction data: 1 byte instruction index + 32 bytes new owner pubkey
        let mut instruction_data = vec![2u8]; // Transfer instruction = 2
        instruction_data.extend_from_slice(vault.key().as_ref());
        
        // Build the transfer instruction for SNS Name Service
        let transfer_ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: NAME_SERVICE_PROGRAM_ID,
            accounts: vec![
                // Name account to transfer
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    ctx.accounts.name_account.key(),
                    false,
                ),
                // Current owner (must sign)
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.owner.key(),
                    true,
                ),
            ],
            data: instruction_data,
        };

        // Execute the CPI call
        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                ctx.accounts.name_account.to_account_info(),
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.name_service_program.to_account_info(),
            ],
        )?;

        // Update domains count
        let vault = &mut ctx.accounts.vault;
        vault.domains_count = vault.domains_count.checked_add(1).unwrap();

        msg!(
            "Unwrapped domain {} deposited to vault. Total domains: {}",
            ctx.accounts.name_account.key(),
            vault.domains_count
        );
        Ok(())
    }

    /// Initialize a token account for the vault to receive a specific token
    /// This creates an ATA owned by the vault PDA for the specified mint
    pub fn init_vault_token_account(ctx: Context<InitVaultTokenAccount>) -> Result<()> {
        msg!(
            "Token account initialized for mint {} in vault",
            ctx.accounts.token_mint.key()
        );
        Ok(())
    }

    /// Withdraw an unwrapped SNS domain from the user's vault
    /// Transfers name registry ownership back to the user
    pub fn withdraw_unwrapped_domain(ctx: Context<WithdrawUnwrappedDomain>) -> Result<()> {
        let vault = &ctx.accounts.vault;

        // Verify the vault has domains
        require!(vault.domains_count > 0, VaultError::NoDomains);

        // Build PDA signer seeds
        let owner_key = ctx.accounts.owner.key();
        let bump = vault.bump;
        let signer_seeds: &[&[u8]] = &[VAULT_SEED, owner_key.as_ref(), &[bump]];

        // Build instruction data: 1 byte instruction index + 32 bytes new owner pubkey
        let mut instruction_data = vec![2u8]; // Transfer instruction = 2
        instruction_data.extend_from_slice(ctx.accounts.owner.key().as_ref());

        // Build the transfer instruction for SNS Name Service
        let transfer_ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: NAME_SERVICE_PROGRAM_ID,
            accounts: vec![
                // Name account to transfer
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    ctx.accounts.name_account.key(),
                    false,
                ),
                // Current owner (vault PDA - must sign)
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    vault.key(),
                    true,
                ),
            ],
            data: instruction_data,
        };

        // Execute the CPI call with PDA signer
        invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.name_account.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.name_service_program.to_account_info(),
            ],
            &[signer_seeds],
        )?;

        // Update domains count
        let vault = &mut ctx.accounts.vault;
        vault.domains_count = vault.domains_count.checked_sub(1).unwrap();

        msg!(
            "Unwrapped domain {} withdrawn from vault. Remaining domains: {}",
            ctx.accounts.name_account.key(),
            vault.domains_count
        );
        Ok(())
    }

    /// Deposit an unwrapped SNS domain AND update the SOL record to point to vault PDA
    /// This atomically:
    /// 1. Transfers domain ownership to the vault PDA  
    /// 2. Creates/updates the SOL record V2 with the vault PDA address
    /// 3. Writes ROA (Right of Association) to verify the record
    pub fn deposit_domain_with_record(ctx: Context<DepositDomainWithRecord>) -> Result<()> {
        let vault = &ctx.accounts.vault;
        let owner_key = ctx.accounts.owner.key();
        let bump = vault.bump;
        let vault_key = vault.key();
        let name_account_key = ctx.accounts.name_account.key();
        
        // Prepare signer seeds for vault PDA
        let signer_seeds: &[&[u8]] = &[VAULT_SEED, owner_key.as_ref(), &[bump]];
        
        // Step 1: Transfer domain ownership to vault PDA
        let mut transfer_data = vec![2u8]; // Transfer instruction = 2
        transfer_data.extend_from_slice(vault_key.as_ref());
        
        let transfer_ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: NAME_SERVICE_PROGRAM_ID,
            accounts: vec![
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    name_account_key,
                    false,
                ),
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    owner_key,
                    true,
                ),
            ],
            data: transfer_data,
        };

        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                ctx.accounts.name_account.to_account_info(),
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.name_service_program.to_account_info(),
            ],
        )?;

        msg!("Domain ownership transferred to vault PDA");

        // Step 2: Allocate and post SOL record V2
        // SNS Records instruction format: tag(1) + record_name(4+len) + content(4+len)
        // tag 1 = allocateAndPostRecord
        // IMPORTANT: Record name MUST include the 0x02 prefix for V2 records!
        let record_name: &[u8] = &[0x02, b'S', b'O', b'L'];
        let vault_pubkey_bytes = vault_key.to_bytes();
        
        // Build instruction data using borsh-like format
        let mut allocate_data = vec![1u8]; // tag = 1 (allocateAndPostRecord)
        // Record name as string: length (u32 little endian) + bytes
        allocate_data.extend_from_slice(&(record_name.len() as u32).to_le_bytes());
        allocate_data.extend_from_slice(record_name);
        // Content as bytes array: length (u32 little endian) + bytes  
        allocate_data.extend_from_slice(&(vault_pubkey_bytes.len() as u32).to_le_bytes());
        allocate_data.extend_from_slice(&vault_pubkey_bytes);

        let allocate_ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: SNS_RECORDS_PROGRAM_ID,
            accounts: vec![
                // System program
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    anchor_lang::solana_program::system_program::ID,
                    false,
                ),
                // Name service program
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    NAME_SERVICE_PROGRAM_ID,
                    false,
                ),
                // Fee payer (owner)
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    owner_key,
                    true,
                ),
                // Record account (to be created)
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    ctx.accounts.sol_record_v2.key(),
                    false,
                ),
                // Domain name account
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    name_account_key,
                    false,
                ),
                // Domain owner (vault PDA - must sign as new owner)
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    vault_key,
                    true,
                ),
                // Central state
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.central_state.key(),
                    false,
                ),
            ],
            data: allocate_data,
        };

        invoke_signed(
            &allocate_ix,
            &[
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.name_service_program.to_account_info(),
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.sol_record_v2.to_account_info(),
                ctx.accounts.name_account.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.central_state.to_account_info(),
                ctx.accounts.sns_records_program.to_account_info(), // Program being invoked
            ],
            &[signer_seeds],
        )?;

        msg!("SOL record V2 created with vault PDA address: {}", vault_key);

        // Step 3: Write ROA (Right of Association) using writeRoa (tag 6)
        // This sets the roaId and marks it as UnverifiedSolana (3)
        let mut roa_data = vec![6u8]; // tag = 6 (writeRoa)
        roa_data.extend_from_slice(&(32u32).to_le_bytes()); // roaId length
        roa_data.extend_from_slice(&vault_pubkey_bytes); // roaId = vault PDA

        let write_roa_ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: SNS_RECORDS_PROGRAM_ID,
            accounts: vec![
                // 0: System program
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    anchor_lang::solana_program::system_program::ID,
                    false,
                ),
                // 1: Name service program
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    NAME_SERVICE_PROGRAM_ID,
                    false,
                ),
                // 2: Fee payer (signer, writable)
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    owner_key,
                    true,
                ),
                // 3: Record account (writable)
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    ctx.accounts.sol_record_v2.key(),
                    false,
                ),
                // 4: Parent domain (writable)
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    name_account_key,
                    false,
                ),
                // 5: Domain owner - vault PDA (signer, writable)
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    vault_key,
                    true,
                ),
                // 6: Central state (readonly)
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.central_state.key(),
                    false,
                ),
            ],
            data: roa_data,
        };

        invoke_signed(
            &write_roa_ix,
            &[
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.name_service_program.to_account_info(),
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.sol_record_v2.to_account_info(),
                ctx.accounts.name_account.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.central_state.to_account_info(),
                ctx.accounts.sns_records_program.to_account_info(),
            ],
            &[signer_seeds],
        )?;

        msg!("ROA written with vault PDA as roaId");

        // Step 4: Validate/verify BOTH staleness AND ROA using validateSolanaSignature (tag 3)
        // staleness = true validates that the domain owner is current (prevents stale records)
        // ROA is validated by having the roaId address (vault PDA) sign at position 7
        let validate_data = vec![
            3u8,  // tag = 3 (validateSolanaSignature)
            1u8,  // staleness = true (validate BOTH staleness and ROA!)
        ];

        let validate_ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: SNS_RECORDS_PROGRAM_ID,
            accounts: vec![
                // 0: System program
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    anchor_lang::solana_program::system_program::ID,
                    false,
                ),
                // 1: Name service program
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    NAME_SERVICE_PROGRAM_ID,
                    false,
                ),
                // 2: Fee payer (signer, writable)
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    owner_key,
                    true,
                ),
                // 3: Record account (writable)
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    ctx.accounts.sol_record_v2.key(),
                    false,
                ),
                // 4: Parent domain (writable)
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    name_account_key,
                    false,
                ),
                // 5: Domain owner - vault PDA (writable, NOT signer here)
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    vault_key,
                    false,
                ),
                // 6: Central state (readonly)
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.central_state.key(),
                    false,
                ),
                // 7: Verifier - vault PDA (signer) - must match roaId to verify
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    vault_key,
                    true,
                ),
            ],
            data: validate_data,
        };

        invoke_signed(
            &validate_ix,
            &[
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.name_service_program.to_account_info(),
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.sol_record_v2.to_account_info(),
                ctx.accounts.name_account.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.central_state.to_account_info(),
                ctx.accounts.vault.to_account_info(), // Position 7: verifier
                ctx.accounts.sns_records_program.to_account_info(),
            ],
            &[signer_seeds],
        )?;

        msg!("SOL record verified - ROA validation upgraded to Solana(1)");

        // Update domains count
        let vault = &mut ctx.accounts.vault;
        vault.domains_count = vault.domains_count.checked_add(1).unwrap();
        let domains_count = vault.domains_count;

        msg!(
            "Domain {} secured with verified SOL record pointing to vault {}. Total domains: {}",
            name_account_key,
            vault_key,
            domains_count
        );
        
        Ok(())
    }
}

/// Pre-computed sha256 hash of "SPL Name Service" + "\x02SOL"
/// This is used for SOL Record V2 PDA derivation
/// sha256("SPL Name Service\x02SOL") = 30ecde95b64ef547d89fde3987039f70b53937a8ffbcc10a285b826fdfa076bd
pub const SOL_RECORD_V2_HASHED_NAME: [u8; 32] = [
    0x30, 0xec, 0xde, 0x95, 0xb6, 0x4e, 0xf5, 0x47,
    0xd8, 0x9f, 0xde, 0x39, 0x87, 0x03, 0x9f, 0x70,
    0xb5, 0x39, 0x37, 0xa8, 0xff, 0xbc, 0xc1, 0x0a,
    0x28, 0x5b, 0x82, 0x6f, 0xdf, 0xa0, 0x76, 0xbd
];

/// Helper function to derive the SOL record V2 PDA for a domain
/// Uses SNS SDK derivation: findProgramAddressSync([hashedName, centralState, domainKey], NAME_PROGRAM_ID)
pub fn get_sol_record_v2_key(domain_name_account: &Pubkey) -> (Pubkey, u8) {
    let (central_state, _) = get_central_state_key();
    
    // Record V2 derivation uses NAME_PROGRAM_ID (not SNS_RECORDS_PROGRAM_ID!)
    Pubkey::find_program_address(
        &[
            &SOL_RECORD_V2_HASHED_NAME,
            central_state.as_ref(),
            domain_name_account.as_ref(),
        ],
        &NAME_SERVICE_PROGRAM_ID,
    )
}

/// Helper function to get the SNS Records V2 central state PDA
/// Central state is derived using the program ID itself as seed
pub fn get_central_state_key() -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SNS_RECORDS_PROGRAM_ID.as_ref()],
        &SNS_RECORDS_PROGRAM_ID,
    )
}

/// User's vault account that stores metadata
#[account]
#[derive(InitSpace)]
pub struct UserVault {
    /// The owner of this vault (user's public key)
    pub owner: Pubkey,
    /// PDA bump seed for signing
    pub bump: u8,
    /// Number of domains currently in the vault
    pub domains_count: u64,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    /// The user initializing their vault
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The vault PDA - derived from the owner's public key
    #[account(
        init,
        payer = owner,
        space = 8 + UserVault::INIT_SPACE,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, UserVault>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositDomain<'info> {
    /// The owner depositing a domain
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The user's vault
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ VaultError::UnauthorizedAccess
    )]
    pub vault: Account<'info, UserVault>,

    /// The SNS domain mint (NFT)
    pub domain_mint: InterfaceAccount<'info, Mint>,

    /// User's token account holding the SNS domain
    #[account(
        mut,
        associated_token::mint = domain_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Vault's token account to receive the SNS domain
    /// We use init_if_needed because the vault may not have a token account for this specific domain yet
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = domain_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawDomain<'info> {
    /// The owner withdrawing a domain
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The user's vault (also acts as authority for vault token accounts)
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ VaultError::UnauthorizedAccess
    )]
    pub vault: Account<'info, UserVault>,

    /// The SNS domain mint (NFT)
    pub domain_mint: InterfaceAccount<'info, Mint>,

    /// Vault's token account holding the SNS domain
    #[account(
        mut,
        associated_token::mint = domain_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    /// User's token account to receive the SNS domain
    /// We use init_if_needed in case user closed their token account
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = domain_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitVaultTokenAccount<'info> {
    /// The owner of the vault (payer for the ATA creation)
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The user's vault
    #[account(
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ VaultError::UnauthorizedAccess
    )]
    pub vault: Account<'info, UserVault>,

    /// The token mint for which to create an ATA
    pub token_mint: InterfaceAccount<'info, Mint>,

    /// The vault's token account (ATA) to be initialized
    #[account(
        init,
        payer = owner,
        associated_token::mint = token_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositUnwrappedDomain<'info> {
    /// The owner depositing a domain
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The user's vault
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ VaultError::UnauthorizedAccess
    )]
    pub vault: Account<'info, UserVault>,

    /// The SNS name account (domain registry)
    /// CHECK: This account is validated by the Name Service program
    #[account(mut)]
    pub name_account: UncheckedAccount<'info>,

    /// The SNS Name Service program
    /// CHECK: This is the official SNS Name Service program
    #[account(address = NAME_SERVICE_PROGRAM_ID)]
    pub name_service_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawUnwrappedDomain<'info> {
    /// The owner withdrawing a domain
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The user's vault (current owner of the domain)
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ VaultError::UnauthorizedAccess
    )]
    pub vault: Account<'info, UserVault>,

    /// The SNS name account (domain registry)
    /// CHECK: This account is validated by the Name Service program
    #[account(mut)]
    pub name_account: UncheckedAccount<'info>,

    /// The SNS Name Service program
    /// CHECK: This is the official SNS Name Service program
    #[account(address = NAME_SERVICE_PROGRAM_ID)]
    pub name_service_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Deposit an unwrapped domain and update SOL record to point to vault PDA
#[derive(Accounts)]
pub struct DepositDomainWithRecord<'info> {
    /// The owner depositing a domain
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The user's vault
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ VaultError::UnauthorizedAccess
    )]
    pub vault: Account<'info, UserVault>,

    /// The SNS name account (domain registry)
    /// CHECK: This account is validated by the Name Service program
    #[account(mut)]
    pub name_account: UncheckedAccount<'info>,

    /// The SOL record V2 account (will be created/updated)
    /// CHECK: This account is derived and validated by the SNS Records V2 program
    #[account(mut)]
    pub sol_record_v2: UncheckedAccount<'info>,

    /// The central state account for SNS Records V2
    /// CHECK: This is the SNS Records V2 central state PDA
    pub central_state: UncheckedAccount<'info>,

    /// The SNS Name Service program
    /// CHECK: This is the official SNS Name Service program
    #[account(address = NAME_SERVICE_PROGRAM_ID)]
    pub name_service_program: UncheckedAccount<'info>,

    /// The SNS Records V2 program
    /// CHECK: This is the official SNS Records V2 program
    #[account(address = SNS_RECORDS_PROGRAM_ID)]
    pub sns_records_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum VaultError {
    #[msg("You are not authorized to access this vault")]
    UnauthorizedAccess,
    #[msg("No domains in the vault")]
    NoDomains,
}
