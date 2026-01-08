use anchor_lang::prelude::*;

declare_id!("LUMPd26Acz4wqS8EBuoxPN2zhwCUF4npbkrqhLbM9AL");

#[program]
pub mod solana_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
