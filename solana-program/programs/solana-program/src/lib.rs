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

#[error_code]
pub enum VaultError {
    #[msg("You are not authorized to access this vault")]
    UnauthorizedAccess,
    #[msg("No domains in the vault")]
    NoDomains,
}
