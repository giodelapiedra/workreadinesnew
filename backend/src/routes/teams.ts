import { Hono } from 'hono'
import bcrypt from 'bcrypt'
import { supabase } from '../lib/supabase'
import { authMiddleware, requireRole, AuthVariables } from '../middleware/auth'
import { getAdminClient } from '../utils/adminClient'
import { generateUniqueQuickLoginCode } from '../utils/quickLoginCode'

const teams = new Hono<{ Variables: AuthVariables }>()

// Get all teams (for transfer selection - team leaders can see other teams)
teams.get('/all', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()

    // Get all teams with their team leaders
    const { data: allTeams, error: teamsError } = await adminClient
      .from('teams')
      .select('id, name, site_location, team_leader_id, users!teams_team_leader_id_fkey(id, email, first_name, last_name, full_name)')
      .order('name', { ascending: true })

    if (teamsError) {
      console.error('Error fetching teams:', teamsError)
      return c.json({ error: 'Failed to fetch teams', details: teamsError.message }, 500)
    }

    // Format teams for selection
    const teamsList = (allTeams || []).map((team: any) => {
      const teamLeader = Array.isArray(team.users) ? team.users[0] : team.users
      return {
        id: team.id,
        name: team.name,
        site_location: team.site_location,
        team_leader: teamLeader ? {
          id: teamLeader.id,
          email: teamLeader.email,
          name: teamLeader.full_name || 
                (teamLeader.first_name && teamLeader.last_name 
                  ? `${teamLeader.first_name} ${teamLeader.last_name}`
                  : teamLeader.email),
        } : null,
        display_name: team.site_location 
          ? `${team.name} • ${team.site_location}`
          : team.name,
      }
    })

    return c.json({ teams: teamsList })
  } catch (error: any) {
    console.error('Get all teams error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get team leader's team with members
teams.get('/', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Get admin client once for this request (reused for all queries)
    const adminClient = getAdminClient()
    
    // Get team leader's team
    // Always use admin client to bypass RLS and prevent caching/shared state issues
    // This ensures queries are always fresh and not affected by other user sessions
    if (process.env.NODE_ENV === 'development') {
      console.log(`[GET /teams] Looking for team with team_leader_id: ${user.id} (${user.email})`)
    }
    
    const { data: team, error: teamError } = await adminClient
      .from('teams')
      .select('*')
      .eq('team_leader_id', user.id)
      .single()

    // If no team exists, return null (user must create team first)
    if (teamError && teamError.code === 'PGRST116') {
      // No team found - user needs to create one
      if (process.env.NODE_ENV === 'development') {
        console.log(`[GET /teams] No team found for team_leader_id: ${user.id} (${user.email}) - returning null`)
      }
      return c.json({
        team: null,
        members: [],
        statistics: {
          totalMembers: 0,
          activeWorkers: 0,
          totalExemptions: 0,
          totalCases: 0,
        },
      })
    }

    if (teamError) {
      console.error('Error fetching team:', teamError)
      return c.json({ error: 'Failed to fetch team', details: teamError.message }, 500)
    }

    if (!team) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[GET /teams] Team query returned null (no error) for team_leader_id: ${user.id} (${user.email}) - returning null`)
      }
      return c.json({
        team: null,
        members: [],
        statistics: {
          totalMembers: 0,
          activeWorkers: 0,
          totalExemptions: 0,
          totalCases: 0,
        },
      })
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(`[GET /teams] ✅ Found team: ${team.name} (id: ${team.id}) for team_leader: ${user.id} (${user.email})`)
    }
    const teamData = team

    // Get team members with user details
    // Reuse the same adminClient created earlier for this request
    // phone is stored in team_members table, first_name and last_name are in users table
    if (process.env.NODE_ENV === 'development') {
      console.log(`[GET /teams] Fetching team members for team_id: ${teamData.id}, team_leader: ${user.id} (${user.email})`)
    }
    
    // Get team members using admin client (bypasses RLS and ensures no shared state)
    const { data: members, error: membersError } = await adminClient
      .from('team_members')
      .select('*')
      .eq('team_id', teamData.id)
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[GET /teams] Found ${members?.length || 0} team members for team_id: ${teamData.id}`)
      if (members && members.length > 0) {
        console.log(`[GET /teams] Team member IDs:`, members.map((m: any) => m.user_id))
      }
    }
    
    if (membersError) {
      console.error('[GET /teams] Error fetching members:', membersError)
      return c.json({ error: 'Failed to fetch team members', details: membersError.message }, 500)
    }
    
    // OPTIMIZATION: Batch fetch all user details in a single query (fixes N+1 problem)
    // This is much more efficient than fetching users one-by-one
    const memberUserIds = (members || []).map((m: any) => m.user_id)
    let userMap = new Map<string, any>()
    
    if (memberUserIds.length > 0) {
      const { data: allUsers, error: usersError } = await adminClient
          .from('users')
          .select('id, email, first_name, last_name, full_name, role')
        .in('id', memberUserIds)
        
      if (usersError) {
        console.error('[GET /teams] Error batch fetching users:', usersError)
      } else if (allUsers) {
        // Create lookup map for O(1) access
        allUsers.forEach((user: any) => {
          userMap.set(user.id, user)
        })
        
        if (process.env.NODE_ENV === 'development') {
          console.log(`[GET /teams] ✅ Batch fetched ${allUsers.length} users for ${memberUserIds.length} team members`)
        }
      }
    }
    
    // Map members to users using the lookup map
    const membersWithUsers = (members || []).map((member: any) => {
      const userData = userMap.get(member.user_id) || null
      
      // Check for orphaned team members (member exists but user doesn't)
      if (!userData && memberUserIds.includes(member.user_id)) {
            console.warn(`[GET /teams] ⚠️ ORPHANED: User ${member.user_id} not found in users table - team_member record exists but user doesn't`)
        }
        
      if (process.env.NODE_ENV === 'development' && userData) {
            console.log(`[GET /teams] ✅ Member ${member.user_id}: email=${userData.email}, first_name="${userData.first_name}", last_name="${userData.last_name}", full_name="${userData.full_name}"`)
        }
        
        return {
          ...member,
        users: userData,
        }
      })
    
    // Log the final result (dev only)
    if (process.env.NODE_ENV === 'development') {
      membersWithUsers.forEach((m: any) => {
        console.log(`[GET /teams] Final member: ${m.users?.email || 'NO USER'} - first_name: "${m.users?.first_name}", last_name: "${m.users?.last_name}", full_name: "${m.users?.full_name}"`)
      })
    }

    // Calculate statistics (handle empty/null data gracefully)
    // Filter out members without user data or provide fallback
    const safeMembers = membersWithUsers
      .filter((m: any) => {
        // Only include members that have valid user data
        if (!m.users) {
          if (process.env.NODE_ENV === 'development') {
            console.warn(`[GET /teams] Filtering out member ${m.user_id} - no user data found`)
          }
          return false
        }
        return true
      })
      .map((m: any) => {
        // Ensure user data is properly structured and handle empty strings as null
        const userData = m.users
        // Convert empty strings to null for consistency
        const firstName = userData.first_name && userData.first_name.trim() !== '' ? userData.first_name : null
        const lastName = userData.last_name && userData.last_name.trim() !== '' ? userData.last_name : null
        const fullName = userData.full_name && userData.full_name.trim() !== '' ? userData.full_name : null
        
        if (process.env.NODE_ENV === 'development') {
          console.log(`[GET /teams] Processing member ${userData.email}: first_name="${firstName}", last_name="${lastName}", full_name="${fullName}"`)
        }
        
        return {
          ...m,
          users: {
            ...userData,
            first_name: firstName,
            last_name: lastName,
            full_name: fullName,
          }
        }
      })
    
    const totalMembers = safeMembers.length
    
    // Get total exemptions and cases (optimized: parallel queries)
    // Use safeMemberIds to avoid conflict with memberUserIds above
    const safeMemberIds = safeMembers.map((m: any) => m.user_id)
    const workerIds = safeMembers.filter((m: any) => m.users?.role === 'worker').map((m: any) => m.user_id)
    let totalExemptions = 0
    let totalCases = 0
    let activeWorkers = 0
    
    if (safeMemberIds.length > 0) {
      // Parallel queries for better performance
      const incidentTypes = ['accident', 'injury', 'medical_leave', 'other']
      
      const [exemptionsResult, casesResult, schedulesResult] = await Promise.all([
        adminClient
          .from('worker_exceptions')
          .select('*', { count: 'exact', head: true })
          .in('user_id', safeMemberIds),
        adminClient
          .from('worker_exceptions')
          .select('*', { count: 'exact', head: true })
          .in('user_id', safeMemberIds)
          .in('exception_type', incidentTypes)
          .eq('assigned_to_whs', true),
        // Get workers with active schedules (using worker_schedules, not work_schedules)
        workerIds.length > 0
          ? adminClient
              .from('worker_schedules')
              .select('worker_id')
              .in('worker_id', workerIds)
              .eq('is_active', true)
          : Promise.resolve({ data: [], error: null })
      ])
      
      if (!exemptionsResult.error && exemptionsResult.count !== null) {
        totalExemptions = exemptionsResult.count
      }
      
      if (!casesResult.error && casesResult.count !== null) {
        totalCases = casesResult.count
      }
      
      // Count unique workers with active schedules
      if (!schedulesResult.error && schedulesResult.data) {
        const workersWithSchedules = new Set(
          (schedulesResult.data as any[]).map((s: any) => s.worker_id)
        )
        activeWorkers = workersWithSchedules.size
      }
    }

    // Get supervisor information if team has a supervisor assigned
    let supervisorInfo = null
    if (teamData.supervisor_id) {
      const { data: supervisorData, error: supervisorError } = await adminClient
        .from('users')
        .select('id, email, first_name, last_name, full_name')
        .eq('id', teamData.supervisor_id)
        .single()
      
      if (!supervisorError && supervisorData) {
        supervisorInfo = {
          id: supervisorData.id,
          email: supervisorData.email,
          first_name: supervisorData.first_name,
          last_name: supervisorData.last_name,
          full_name: supervisorData.full_name || 
                     (supervisorData.first_name && supervisorData.last_name 
                       ? `${supervisorData.first_name} ${supervisorData.last_name}`
                       : supervisorData.email),
        }
      }
    }

    // Add cache-control headers to prevent any caching
    return c.json({
      team: teamData,
      supervisor: supervisorInfo,
      members: safeMembers,
      statistics: {
        totalMembers,
        activeWorkers,
        totalExemptions,
        totalCases,
      },
    }, 200, {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    })
  } catch (error: any) {
    console.error('Get team error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Add team member (create user and add to team)
teams.post('/members', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const { email, password, first_name, last_name, phone, role = 'worker' } = await c.req.json()

    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400)
    }

    // Team leaders can only create worker accounts
    if (role !== 'worker') {
      return c.json({ error: 'Team leaders can only create worker accounts. Contact administrator for other roles.' }, 403)
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return c.json({ error: 'Invalid email format' }, 400)
    }

    // Use admin client to bypass RLS
    const adminClient = getAdminClient()

    // Get team leader's business_name to inherit to worker
    const { data: teamLeaderData, error: teamLeaderDataError } = await adminClient
      .from('users')
      .select('business_name')
      .eq('id', user.id)
      .single()

    if (teamLeaderDataError) {
      console.error('Error fetching team leader data:', teamLeaderDataError)
      return c.json({ error: 'Failed to fetch team leader data', details: teamLeaderDataError.message }, 500)
    }

    // Get team leader's team
    const { data: team, error: teamError } = await adminClient
      .from('teams')
      .select('id')
      .eq('team_leader_id', user.id)
      .single()

    if (teamError || !team) {
      return c.json({ error: 'Team not found' }, 404)
    }

    // Check if user already exists in database FIRST (before creating auth user)
    const { data: existingUser } = await adminClient
      .from('users')
      .select('id, email, role, first_name, last_name, full_name')
      .eq('email', email)
      .single()

    if (existingUser) {
      // User already exists - just add them to team (no need to create new user)
      
      // Check if user is already in this team
      const { data: existingMember } = await adminClient
        .from('team_members')
        .select('id')
        .eq('team_id', team.id)
        .eq('user_id', existingUser.id)
        .single()

      if (existingMember) {
        return c.json({ error: 'User is already a member of this team' }, 409)
      }

      // Add existing user to team
      const { data: member, error: memberError } = await adminClient
        .from('team_members')
        .insert([
          {
            team_id: team.id,
            user_id: existingUser.id,
            compliance_percentage: 100,
            phone: phone || null,
          },
        ])
        .select('*')
        .single()

      if (memberError) {
        return c.json({ error: 'Failed to add existing user to team', details: memberError.message }, 500)
      }

      // Return member with user data
      const memberWithUser = {
        ...member,
        users: {
          id: existingUser.id,
          email: existingUser.email,
          first_name: existingUser.first_name,
          last_name: existingUser.last_name,
          full_name: existingUser.full_name,
          role: existingUser.role,
        }
      }

      return c.json({
        message: 'Existing user added to team successfully',
        member: memberWithUser,
      }, 201)
    }

    // User doesn't exist - create new user
    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError || !authData.user) {
      if (authError?.message?.includes('already registered') || 
          authError?.message?.includes('User already registered') ||
          authError?.message?.includes('already exists')) {
        return c.json({ error: 'User with this email already exists in auth system. Please try again.' }, 409)
      }
      console.error('Supabase Auth error:', authError)
      return c.json({ 
        error: 'Failed to create user', 
        details: authError?.message,
        code: authError?.status 
      }, 500)
    }

    // Hash password with bcrypt (for consistency with registration)
    const saltRounds = 10
    const hashedPassword = await bcrypt.hash(password, saltRounds)

    // Prepare user data - first_name and last_name are required
    const trimmedFirstName = first_name?.trim() || ''
    const trimmedLastName = last_name?.trim() || ''
    const fullName = `${trimmedFirstName} ${trimmedLastName}`.trim() || email.split('@')[0]

    const userInsertData: any = {
      id: authData.user.id,
      email: authData.user.email,
      role: role,
      password_hash: hashedPassword,
      first_name: trimmedFirstName || email.split('@')[0],
      last_name: trimmedLastName || '',
      full_name: fullName, // Store for backward compatibility
      business_name: teamLeaderData?.business_name || null, // Inherit from team leader
      created_at: new Date().toISOString(),
    }

    // Auto-generate quick login code for workers
    if (role === 'worker') {
      userInsertData.quick_login_code = await generateUniqueQuickLoginCode()
    }

    // Create user record in database using admin client (bypasses RLS)
    const { data: userData, error: userError } = await adminClient
      .from('users')
      .insert([userInsertData])
      .select()
      .single()

    if (userError) {
      console.error('Database insert error:', userError)
      console.error('Error details:', JSON.stringify(userError, null, 2))
      // Clean up auth user
      await supabase.auth.admin.deleteUser(authData.user.id)
      return c.json({ 
        error: 'Failed to create user record', 
        details: userError.message,
        code: userError.code,
        hint: userError.hint 
      }, 500)
    }

    // Add user to team using admin client (bypasses RLS)
    const { data: member, error: memberError } = await adminClient
      .from('team_members')
      .insert([
        {
          team_id: team.id,
          user_id: userData.id,
          compliance_percentage: 100, // Default to 100%
          phone: phone || null,
        },
      ])
      .select('*')
      .single()

    if (memberError) {
      // Clean up using admin client
      await adminClient.from('users').delete().eq('id', userData.id)
      await supabase.auth.admin.deleteUser(authData.user.id)
      return c.json({ error: 'Failed to add member to team', details: memberError.message }, 500)
    }

    // Manually attach user data to member response
    const memberWithUser = {
      ...member,
      users: {
        id: userData.id,
        email: userData.email,
        first_name: userData.first_name,
        last_name: userData.last_name,
        full_name: userData.full_name,
        role: userData.role,
      }
    }

    return c.json({
      message: 'Team member added successfully',
      member: memberWithUser,
    }, 201)
  } catch (error: any) {
    console.error('Add team member error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Update team member
teams.patch('/members/:memberId', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const memberId = c.req.param('memberId')
    const { compliance_percentage, phone, first_name, last_name, role } = await c.req.json()

    // Verify team leader owns this team
    const { data: member, error: memberError } = await supabase
      .from('team_members')
      .select(`
        *,
        teams!inner (
          team_leader_id
        )
      `)
      .eq('id', memberId)
      .single()

    if (memberError || !member) {
      return c.json({ error: 'Team member not found or unauthorized' }, 404)
    }

    const team = Array.isArray(member.teams) ? member.teams[0] : member.teams
    if (!team || team.team_leader_id !== user.id) {
      return c.json({ error: 'Team member not found or unauthorized' }, 404)
    }

    // Update team member
    const updates: any = {}
    if (compliance_percentage !== undefined) updates.compliance_percentage = compliance_percentage
    if (phone !== undefined) updates.phone = phone

    const { data: updatedMember, error: updateError } = await supabase
      .from('team_members')
      .update(updates)
      .eq('id', memberId)
      .select('*')
      .single()

    if (updateError) {
      return c.json({ error: 'Failed to update member', details: updateError.message }, 500)
    }

    // Fetch user data manually using admin client to bypass RLS
    let userData: any = null
    const adminClient = getAdminClient()
    const { data: fetchedUserData } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name, full_name, role')
      .eq('id', updatedMember.user_id)
      .single()
    
    userData = fetchedUserData

    // Update user info if provided (phone is in team_members, not users)
    if (first_name !== undefined || last_name !== undefined || role !== undefined) {
      const userUpdates: any = {}
      if (first_name !== undefined) {
        userUpdates.first_name = first_name.trim()
        // Also update full_name for backward compatibility
        const trimmedFirstName = first_name.trim()
        const trimmedLastName = last_name !== undefined ? last_name.trim() : (userData?.last_name || '')
        userUpdates.full_name = `${trimmedFirstName} ${trimmedLastName}`.trim()
      }
      if (last_name !== undefined) {
        userUpdates.last_name = last_name.trim()
        // Also update full_name for backward compatibility
        const trimmedFirstName = first_name !== undefined ? first_name.trim() : (userData?.first_name || '')
        const trimmedLastName = last_name.trim()
        userUpdates.full_name = `${trimmedFirstName} ${trimmedLastName}`.trim()
      }
      if (role !== undefined) userUpdates.role = role

      await adminClient
        .from('users')
        .update(userUpdates)
        .eq('id', updatedMember.user_id)
      
      // Refresh user data after update
      const { data: updatedUserData } = await adminClient
        .from('users')
        .select('id, email, first_name, last_name, full_name, role')
        .eq('id', updatedMember.user_id)
        .single()
      
      if (updatedUserData) {
        userData = updatedUserData
      }
    }

    // Attach user data to response
    const memberWithUser = {
      ...updatedMember,
      users: userData ? {
        id: userData.id,
        email: userData.email,
        first_name: userData.first_name,
        last_name: userData.last_name,
        full_name: userData.full_name,
        role: userData.role,
      } : null,
    }

    return c.json({
      message: 'Team member updated successfully',
      member: memberWithUser,
    })
  } catch (error: any) {
    console.error('Update team member error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Remove team member
teams.delete('/members/:memberId', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const memberId = c.req.param('memberId')

    // Verify team leader owns this team and get member's role
    const adminClient = getAdminClient()
    const { data: member, error: memberError } = await supabase
      .from('team_members')
      .select(`
        user_id,
        teams!inner (
          team_leader_id
        )
      `)
      .eq('id', memberId)
      .single()

    if (memberError || !member) {
      return c.json({ error: 'Team member not found or unauthorized' }, 404)
    }

    const team = Array.isArray(member.teams) ? member.teams[0] : member.teams
    if (!team || team.team_leader_id !== user.id) {
      return c.json({ error: 'Team member not found or unauthorized' }, 404)
    }

    // Get member's role to check if they are a worker
    const { data: userData, error: userError } = await adminClient
      .from('users')
      .select('role')
      .eq('id', member.user_id)
      .single()

    if (userError || !userData) {
      return c.json({ error: 'Failed to fetch user data' }, 500)
    }

    // Prevent team leaders from deleting workers - only admin can delete workers
    if (userData.role === 'worker') {
      return c.json({ error: 'Cannot remove worker. Only administrators can delete worker accounts.' }, 403)
    }

    // Remove from team (don't delete user, just remove from team)
    const { error: deleteError } = await supabase
      .from('team_members')
      .delete()
      .eq('id', memberId)

    if (deleteError) {
      return c.json({ error: 'Failed to remove member', details: deleteError.message }, 500)
    }

    return c.json({ message: 'Team member removed successfully' })
  } catch (error: any) {
    console.error('Remove team member error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Create team (for first time setup)
teams.post('/', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Check if team already exists
    const { data: existingTeam } = await supabase
      .from('teams')
      .select('id')
      .eq('team_leader_id', user.id)
      .single()

    if (existingTeam) {
      return c.json({ error: 'Team already exists for this user' }, 400)
    }

    const { name, site_location } = await c.req.json()

    if (!name || name.trim() === '') {
      return c.json({ error: 'Team name is required' }, 400)
    }

    const { data: team, error: createError } = await supabase
      .from('teams')
      .insert([
        {
          team_leader_id: user.id,
          name: name.trim(),
          site_location: site_location?.trim() || '',
        },
      ])
      .select()
      .single()

    if (createError) {
      return c.json({ error: 'Failed to create team', details: createError.message }, 500)
    }

    return c.json({
      message: 'Team created successfully',
      team,
    }, 201)
  } catch (error: any) {
    console.error('Create team error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// ============================================
// Worker Exceptions Endpoints
// ============================================

// Get all exceptions for team members (team leader only)
teams.get('/exceptions', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()

    // Get team leader's team
    const { data: team } = await adminClient
      .from('teams')
      .select('id')
      .eq('team_leader_id', user.id)
      .single()

    if (!team) {
      return c.json({ error: 'Team not found' }, 404)
    }

    // Get all active exceptions for team members
    // Use explicit foreign key relationship to avoid ambiguity (user_id, not created_by)
    const { data: exceptions, error } = await adminClient
      .from('worker_exceptions')
      .select('*, users!worker_exceptions_user_id_fkey(id, email, first_name, last_name, full_name)')
      .eq('team_id', team.id)
      .eq('is_active', true)
      .order('start_date', { ascending: false })

    if (error) {
      console.error('Error fetching exceptions:', error)
      return c.json({ error: 'Failed to fetch exceptions', details: error.message }, 500)
    }

    return c.json({ exceptions: exceptions || [] })
  } catch (error: any) {
    console.error('Get exceptions error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get exception for a specific worker
teams.get('/members/:memberId/exception', authMiddleware, requireRole(['team_leader', 'worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const memberId = c.req.param('memberId')
    const adminClient = getAdminClient()

    // Get team member
    const { data: member } = await adminClient
      .from('team_members')
      .select('user_id, team_id, teams(team_leader_id)')
      .eq('id', memberId)
      .single()

    if (!member) {
      return c.json({ error: 'Team member not found' }, 404)
    }

    // Verify access (team leader or worker themselves)
    const team = Array.isArray(member.teams) ? member.teams[0] : member.teams
    const isTeamLeader = team?.team_leader_id === user.id
    const isWorker = member.user_id === user.id

    if (!isTeamLeader && !isWorker) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    // Get active exception for this worker (include assigned_to_whs)
    const { data: exception, error } = await adminClient
      .from('worker_exceptions')
      .select('*, assigned_to_whs')
      .eq('user_id', member.user_id)
      .eq('is_active', true)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching exception:', error)
      return c.json({ error: 'Failed to fetch exception', details: error.message }, 500)
    }

    return c.json({ exception: exception || null })
  } catch (error: any) {
    console.error('Get exception error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Create or update exception for a worker (team leader only)
teams.post('/members/:memberId/exception', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const memberId = c.req.param('memberId')
    const { exception_type, reason, start_date, end_date, transfer_to_team_id } = await c.req.json()

    if (!exception_type || !start_date) {
      return c.json({ error: 'Exception type and start date are required' }, 400)
    }

    const validTypes = ['transfer', 'accident', 'injury', 'medical_leave', 'other']
    if (!validTypes.includes(exception_type)) {
      return c.json({ error: 'Invalid exception type' }, 400)
    }

    // If transfer, require transfer_to_team_id
    if (exception_type === 'transfer' && !transfer_to_team_id) {
      return c.json({ error: 'Transfer requires selecting a target team' }, 400)
    }

    const adminClient = getAdminClient()

    // Get team member and verify team leader owns this team
    const { data: member } = await adminClient
      .from('team_members')
      .select('user_id, team_id, teams(team_leader_id)')
      .eq('id', memberId)
      .single()

    if (!member) {
      return c.json({ error: 'Team member not found' }, 404)
    }

    const team = Array.isArray(member.teams) ? member.teams[0] : member.teams
    if (!team || team.team_leader_id !== user.id) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    // OPTIMIZATION: Use maybeSingle to avoid error when no exception exists
    // Check if worker has an active exception - prevent modification if created by supervisor or assigned to WHS
    const { data: existingException, error: existingError } = await adminClient
      .from('worker_exceptions')
      .select('id, assigned_to_whs, is_active, created_by, users!worker_exceptions_created_by_fkey(role)')
      .eq('user_id', member.user_id)
      .eq('is_active', true)
      .maybeSingle()

    if (existingException) {
      // Check if exception is assigned to WHS
      if (existingException.assigned_to_whs) {
        return c.json({ 
          error: 'Cannot modify exception: This exception has been assigned to WHS and must be closed by WHS first before it can be modified.' 
        }, 403)
      }
      
      // Check if exception was created by supervisor
      const creator = Array.isArray(existingException.users) ? existingException.users[0] : existingException.users
      if (creator && creator.role === 'supervisor') {
        return c.json({ 
          error: 'Cannot modify exception: This exception was created by a Site Supervisor and cannot be modified until the supervisor closes the incident.' 
        }, 403)
      }
    }

    // OPTIMIZATION: Automatically deactivate all active schedules when exception is created
    // This uses the new worker schedule logic - schedules are soft-deleted (is_active = false)
    // but data remains in database for analytics purposes
    let deactivatedScheduleCount = 0
    try {
      // OPTIMIZATION: Use count query instead of fetching all IDs to reduce data transfer
      const { count: scheduleCount, error: countError } = await adminClient
        .from('worker_schedules')
        .select('*', { count: 'exact', head: true })
        .eq('worker_id', member.user_id)
        .eq('is_active', true)
      
      if (!countError && scheduleCount && scheduleCount > 0) {
        // Only update if there are active schedules
        const { error: deactivateError } = await adminClient
          .from('worker_schedules')
          .update({ is_active: false })
          .eq('worker_id', member.user_id)
          .eq('is_active', true)

        if (deactivateError) {
          console.error('[POST /teams/members/:memberId/exception] Error deactivating schedules:', deactivateError)
          // Don't fail the exception creation if schedule deactivation fails
        } else {
          deactivatedScheduleCount = scheduleCount
          if (deactivatedScheduleCount > 0) {
            console.log(`[POST /teams/members/:memberId/exception] Automatically deactivated ${deactivatedScheduleCount} active schedule(s) for worker ${member.user_id} (Exception created)`)
          }
        }
      }
    } catch (deactivateScheduleError: any) {
      console.error('[POST /teams/members/:memberId/exception] Error in schedule deactivation process:', deactivateScheduleError)
      // Don't fail the exception creation if schedule deactivation fails
    }

    // If transfer, verify target team exists and is different
    if (exception_type === 'transfer') {
      if (transfer_to_team_id === member.team_id) {
        return c.json({ error: 'Cannot transfer worker to the same team' }, 400)
      }

      const { data: targetTeam, error: targetTeamError } = await adminClient
        .from('teams')
        .select('id, name')
        .eq('id', transfer_to_team_id)
        .single()

      if (targetTeamError || !targetTeam) {
        return c.json({ error: 'Target team not found' }, 404)
      }

      // Move worker to new team
      const { error: transferError } = await adminClient
        .from('team_members')
        .update({ team_id: transfer_to_team_id })
        .eq('id', memberId)

      if (transferError) {
        console.error('Error transferring worker:', transferError)
        return c.json({ error: 'Failed to transfer worker to new team', details: transferError.message }, 500)
      }
    }

    // Deactivate any existing active exception for this worker and set deactivated_at timestamp
    await adminClient
      .from('worker_exceptions')
      .update({ 
        is_active: false,
        deactivated_at: new Date().toISOString()
      })
      .eq('user_id', member.user_id)
      .eq('is_active', true)

    // Use new team_id if transfer, otherwise use current team_id
    const finalTeamId = exception_type === 'transfer' ? transfer_to_team_id : member.team_id

    // Create new exception
    const { data: exception, error } = await adminClient
      .from('worker_exceptions')
      .insert([
        {
          user_id: member.user_id,
          team_id: finalTeamId,
          exception_type,
          reason: reason || null,
          start_date,
          end_date: end_date || null,
          is_active: true,
          created_by: user.id,
        },
      ])
      .select('*')
      .single()

    if (error) {
      console.error('Error creating exception:', error)
      return c.json({ error: 'Failed to create exception', details: error.message }, 500)
    }

    return c.json({
      message: exception_type === 'transfer' ? 'Worker transferred successfully' : 'Exception created successfully',
      exception,
      transferred: exception_type === 'transfer',
      deactivatedSchedules: deactivatedScheduleCount,
      ...(deactivatedScheduleCount > 0 && {
        scheduleMessage: `${deactivatedScheduleCount} active schedule(s) were automatically deactivated. Schedule data is preserved for analytics.`
      }),
    }, 201)
  } catch (error: any) {
    console.error('Create exception error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Update exception
teams.patch('/exceptions/:exceptionId', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const exceptionId = c.req.param('exceptionId')
    const { exception_type, reason, start_date, end_date, is_active } = await c.req.json()

    const adminClient = getAdminClient()

    // Verify team leader owns this exception
    const { data: exception, error: exceptionError } = await adminClient
      .from('worker_exceptions')
      .select('*, teams(team_leader_id), users!worker_exceptions_created_by_fkey(role)')
      .eq('id', exceptionId)
      .single()

    if (!exception || exceptionError) {
      return c.json({ error: 'Exception not found' }, 404)
    }

    const team = Array.isArray(exception.teams) ? exception.teams[0] : exception.teams
    if (!team || team.team_leader_id !== user.id) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    // Prevent update if exception is assigned to WHS
    if (exception.assigned_to_whs) {
      return c.json({ 
        error: 'Cannot update exception: This exception has been assigned to WHS and must be closed by WHS first before it can be modified.' 
      }, 403)
    }

    // Prevent update if exception was created by supervisor
    const creator = Array.isArray(exception.users) ? exception.users[0] : exception.users
    if (creator && creator.role === 'supervisor') {
      return c.json({ 
        error: 'Cannot update exception: This exception was created by a Site Supervisor and cannot be modified until the supervisor closes the incident.' 
      }, 403)
    }

    // Build update object
    const updates: any = {}
    if (exception_type) updates.exception_type = exception_type
    if (reason !== undefined) updates.reason = reason
    if (start_date) updates.start_date = start_date
    if (end_date !== undefined) updates.end_date = end_date
    if (is_active !== undefined) {
      updates.is_active = is_active
      // If setting to inactive, set deactivated_at timestamp
      if (is_active === false) {
        updates.deactivated_at = new Date().toISOString()
      } else if (is_active === true) {
        // If reactivating, clear deactivated_at
        updates.deactivated_at = null
      }
    }

    // OPTIMIZATION: Automatically deactivate all active schedules when exception is activated
    // This uses the new worker schedule logic - schedules are soft-deleted (is_active = false)
    // but data remains in database for analytics purposes
    let deactivatedScheduleCount = 0
    if (is_active === true) {
      try {
        // OPTIMIZATION: Use count query instead of fetching all IDs to reduce data transfer
        const { count: scheduleCount, error: countError } = await adminClient
          .from('worker_schedules')
          .select('*', { count: 'exact', head: true })
          .eq('worker_id', exception.user_id)
          .eq('is_active', true)
        
        if (!countError && scheduleCount && scheduleCount > 0) {
          // Only update if there are active schedules
          const { error: deactivateError } = await adminClient
            .from('worker_schedules')
            .update({ is_active: false })
            .eq('worker_id', exception.user_id)
            .eq('is_active', true)

          if (deactivateError) {
            console.error('[PATCH /teams/exceptions/:exceptionId] Error deactivating schedules:', deactivateError)
            // Don't fail the exception update if schedule deactivation fails
          } else {
            deactivatedScheduleCount = scheduleCount
            if (deactivatedScheduleCount > 0) {
              console.log(`[PATCH /teams/exceptions/:exceptionId] Automatically deactivated ${deactivatedScheduleCount} active schedule(s) for worker ${exception.user_id} (Exception activated)`)
            }
          }
        }
      } catch (deactivateScheduleError: any) {
        console.error('[PATCH /teams/exceptions/:exceptionId] Error in schedule deactivation process:', deactivateScheduleError)
        // Don't fail the exception update if schedule deactivation fails
      }
    }

    const { data: updatedException, error } = await adminClient
      .from('worker_exceptions')
      .update(updates)
      .eq('id', exceptionId)
      .select('*')
      .single()

    if (error) {
      console.error('Error updating exception:', error)
      return c.json({ error: 'Failed to update exception', details: error.message }, 500)
    }

    // Invalidate cache for analytics (since exception update affects analytics)
    try {
      const { cache } = await import('../utils/cache')
      
      // Invalidate analytics cache for this team leader
      cache.deleteByUserId(user.id, ['analytics'])
      
      // Also invalidate supervisor analytics if supervisor exists
      const { data: supervisorData } = await adminClient
        .from('teams')
        .select('supervisor_id')
        .eq('id', exception.team_id)
        .single()
      
      if (supervisorData?.supervisor_id) {
        cache.deleteByUserId(supervisorData.supervisor_id, ['supervisor-analytics'])
      }
    } catch (cacheError: any) {
      console.error('[PATCH /teams/exceptions/:exceptionId] Error invalidating cache:', cacheError)
      // Don't fail the request if cache invalidation fails
    }

    return c.json({
      message: 'Exception updated successfully',
      exception: updatedException,
      ...(is_active === true && deactivatedScheduleCount > 0 && {
        deactivatedSchedules: deactivatedScheduleCount,
        scheduleMessage: `${deactivatedScheduleCount} active schedule(s) were automatically deactivated. Schedule data is preserved for analytics.`
      }),
    })
  } catch (error: any) {
    console.error('Update exception error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Delete/deactivate exception
teams.delete('/exceptions/:exceptionId', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const exceptionId = c.req.param('exceptionId')
    const adminClient = getAdminClient()

    // Verify team leader owns this exception
    const { data: exception, error: exceptionError } = await adminClient
      .from('worker_exceptions')
      .select('*, teams(team_leader_id), users!worker_exceptions_created_by_fkey(role)')
      .eq('id', exceptionId)
      .single()

    if (!exception || exceptionError) {
      return c.json({ error: 'Exception not found' }, 404)
    }

    const team = Array.isArray(exception.teams) ? exception.teams[0] : exception.teams
    if (!team || team.team_leader_id !== user.id) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    // Prevent deletion if exception is assigned to WHS
    if (exception.assigned_to_whs) {
      return c.json({ 
        error: 'Cannot remove exception: This exception has been assigned to WHS and must be closed by WHS first before it can be removed.' 
      }, 403)
    }

    // Prevent deletion if exception was created by supervisor
    const creator = Array.isArray(exception.users) ? exception.users[0] : exception.users
    if (creator && creator.role === 'supervisor') {
      return c.json({ 
        error: 'Cannot remove exception: This exception was created by a Site Supervisor and cannot be removed until the supervisor closes the incident.' 
      }, 403)
    }

    // OPTIMIZATION: Automatically reactivate all inactive schedules for this worker when exception is removed
    // This uses the new worker schedule logic - schedules that were deactivated due to exception will be reactivated
    let reactivatedScheduleCount = 0
    try {
      // OPTIMIZATION: Use count query instead of fetching all IDs to reduce data transfer
      const { count: scheduleCount, error: countError } = await adminClient
        .from('worker_schedules')
        .select('*', { count: 'exact', head: true })
        .eq('worker_id', exception.user_id)
        .eq('is_active', false)
      
      if (!countError && scheduleCount && scheduleCount > 0) {
        // Only update if there are inactive schedules
        const { error: reactivateError } = await adminClient
          .from('worker_schedules')
          .update({ is_active: true })
          .eq('worker_id', exception.user_id)
          .eq('is_active', false)

        if (reactivateError) {
          console.error('[DELETE /teams/exceptions/:exceptionId] Error reactivating schedules:', reactivateError)
          // Don't fail the exception deletion if schedule reactivation fails
        } else {
          reactivatedScheduleCount = scheduleCount
          if (reactivatedScheduleCount > 0) {
            console.log(`[DELETE /teams/exceptions/:exceptionId] Automatically reactivated ${reactivatedScheduleCount} schedule(s) for worker ${exception.user_id} (Exception removed)`)
          }
        }
      }
    } catch (reactivateScheduleError: any) {
      console.error('[DELETE /teams/exceptions/:exceptionId] Error in schedule reactivation process:', reactivateScheduleError)
      // Don't fail the exception deletion if schedule reactivation fails
    }

    // Deactivate exception (soft delete) and set deactivated_at timestamp
    const { error } = await adminClient
      .from('worker_exceptions')
      .update({ 
        is_active: false,
        deactivated_at: new Date().toISOString()
      })
      .eq('id', exceptionId)

    if (error) {
      console.error('Error deactivating exception:', error)
      return c.json({ error: 'Failed to deactivate exception', details: error.message }, 500)
    }

    // Invalidate cache for analytics (since exception deactivation affects analytics)
    try {
      const { cache } = await import('../utils/cache')
      
      // Invalidate analytics cache for this team leader
      cache.deleteByUserId(user.id, ['analytics'])
      
      // Also invalidate supervisor analytics if supervisor exists
      const { data: supervisorData } = await adminClient
        .from('teams')
        .select('supervisor_id')
        .eq('id', exception.team_id)
        .single()
      
      if (supervisorData?.supervisor_id) {
        cache.deleteByUserId(supervisorData.supervisor_id, ['supervisor-analytics'])
      }
    } catch (cacheError: any) {
      console.error('[DELETE /teams/exceptions/:exceptionId] Error invalidating cache:', cacheError)
      // Don't fail the request if cache invalidation fails
    }

    return c.json({ 
      message: 'Exception deactivated successfully',
      reactivatedSchedules: reactivatedScheduleCount,
      ...(reactivatedScheduleCount > 0 && {
        scheduleMessage: `${reactivatedScheduleCount} schedule(s) were automatically reactivated for this worker.`
      }),
    })
  } catch (error: any) {
    console.error('Delete exception error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Update team info
teams.patch('/', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const { name, site_location } = await c.req.json()

    if (!name || name.trim() === '') {
      return c.json({ error: 'Team name is required' }, 400)
    }

    const updates: any = {}
    if (name) updates.name = name.trim()
    if (site_location !== undefined) updates.site_location = site_location.trim()

    const { data: team, error: updateError } = await supabase
      .from('teams')
      .update(updates)
      .eq('team_leader_id', user.id)
      .select()
      .single()

    if (updateError) {
      return c.json({ error: 'Failed to update team', details: updateError.message }, 500)
    }

    return c.json({
      message: 'Team updated successfully',
      team,
    })
  } catch (error: any) {
    console.error('Update team error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get worker's team information (WORKER ONLY - supervisors should use supervisor endpoints)
teams.get('/my-team', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      console.log('[GET /teams/my-team] No user in context - unauthorized')
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Additional role verification - double check to ensure user is actually a worker
    if (user.role !== 'worker') {
      console.warn(`[GET /teams/my-team] SECURITY: User ${user.id} (${user.email}) with role '${user.role}' attempted to access worker-only endpoint. Access denied.`)
      return c.json({ error: 'Forbidden: This endpoint is only accessible to workers' }, 403)
    }

    // Log the request for debugging
    console.log(`[GET /teams/my-team] Request from user: ${user.id} (${user.email}), role: ${user.role}`)

    // Use admin client to bypass RLS for team_members lookup
    const adminClient = getAdminClient()

    // Get the team_member record for this worker
    // First, check if there are ANY team_members records with this user_id (for debugging)
    const { data: allMemberRecords, error: checkError } = await adminClient
      .from('team_members')
      .select('id, user_id, team_id')
      .eq('user_id', user.id)

    console.log(`[GET /teams/my-team] Checking team_members for user ${user.id} (${user.email}): Found ${allMemberRecords?.length || 0} records`)
    if (allMemberRecords && allMemberRecords.length > 0) {
      console.log(`[GET /teams/my-team] Team member records:`, allMemberRecords.map(m => ({ id: m.id, user_id: m.user_id, team_id: m.team_id })))
    }

    // Now get the single record
    const { data: teamMember, error: memberError } = await adminClient
      .from('team_members')
      .select('team_id')
      .eq('user_id', user.id)
      .single()

    if (memberError || !teamMember) {
      // Log the error for debugging
      if (memberError) {
        console.log(`[GET /teams/my-team] No team_member found for user ${user.id} (${user.email}):`, memberError.code, memberError.message)
        
        // If there ARE records but .single() failed, it means multiple records exist
        if (memberError.code === 'PGRST116' && allMemberRecords && allMemberRecords.length > 1) {
          console.error(`[GET /teams/my-team] WARNING: Multiple team_member records found for user ${user.id}! This should not happen.`)
          // Use the first one
          const firstMember = allMemberRecords[0]
          console.log(`[GET /teams/my-team] Using first team_member record: team_id=${firstMember.team_id}`)
          
          // Continue with first member
          const { data: teamData, error: teamError } = await adminClient
            .from('teams')
            .select('id, name, site_location, team_leader_id')
            .eq('id', firstMember.team_id)
            .single()
          
          if (teamError || !teamData) {
            console.error('[GET /teams/my-team] Error fetching team for first member:', teamError)
            return c.json({
              team: null,
              teamName: null,
              siteLocation: null,
              displayName: null,
            })
          }
          const { data: teamLeader } = await adminClient
            .from('users')
            .select('id, email, first_name, last_name, full_name')
            .eq('id', teamData.team_leader_id)
            .single()

          const displayName = teamData.site_location 
            ? `${teamData.name} • ${teamData.site_location}`
            : teamData.name

          console.log(`[GET /teams/my-team] Returning team data for user ${user.id} (${user.email}): team=${teamData.name}, team_id=${teamData.id}`)

          return c.json({
            team: {
              id: teamData.id,
              name: teamData.name,
              site_location: teamData.site_location,
            },
            teamName: teamData.name,
            siteLocation: teamData.site_location,
            displayName,
            teamLeader: teamLeader ? {
              id: teamLeader.id,
              email: teamLeader.email,
              name: teamLeader.full_name || 
                    (teamLeader.first_name && teamLeader.last_name 
                      ? `${teamLeader.first_name} ${teamLeader.last_name}`
                      : teamLeader.email),
            } : null,
          })
        }
      } else {
        console.log(`[GET /teams/my-team] No team_member record found for user ${user.id} (${user.email})`)
      }
      
      // Worker is not assigned to any team
      return c.json({
        team: null,
        teamName: null,
        siteLocation: null,
        displayName: null,
      })
    }

    console.log(`[GET /teams/my-team] Found team_member with team_id: ${teamMember.team_id}`)

    // Get the team information
    const { data: team, error: teamError } = await adminClient
      .from('teams')
      .select('id, name, site_location, team_leader_id')
      .eq('id', teamMember.team_id)
      .single()

    if (teamError || !team) {
      console.error('[GET /teams/my-team] Error fetching team:', teamError)
      return c.json({ error: 'Failed to fetch team information', details: teamError?.message }, 500)
    }

    console.log(`[GET /teams/my-team] Found team: ${team.name} (id: ${team.id})`)

    // Get team leader information
    const { data: teamLeader, error: leaderError } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name, full_name')
      .eq('id', team.team_leader_id)
      .single()

    // Build display name: "Team Name • Site Location" or just "Team Name"
    const displayName = team.site_location 
      ? `${team.name} • ${team.site_location}`
      : team.name

    return c.json({
      team: {
        id: team.id,
        name: team.name,
        site_location: team.site_location,
        team_leader_id: team.team_leader_id,
      },
      teamName: team.name,
      siteLocation: team.site_location,
      displayName: displayName,
      teamLeader: teamLeader ? {
        email: teamLeader.email,
        full_name: teamLeader.full_name,
      } : null,
    })
  } catch (error: any) {
    console.error('Get worker team error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get team members' daily check-ins for a specific date or date range (team leader only)
// Query params: startDate (YYYY-MM-DD), endDate (YYYY-MM-DD) - optional, defaults to today
//               date (YYYY-MM-DD) - single date (legacy support, converts to startDate=endDate=date)
teams.get('/check-ins', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Additional role verification
    if (user.role !== 'team_leader') {
      console.warn(`[GET /teams/check-ins] SECURITY: User ${user.id} (${user.email}) with role '${user.role}' attempted to access team-leader-only endpoint. Access denied.`)
      return c.json({ error: 'Forbidden: This endpoint is only accessible to team leaders' }, 403)
    }

    const adminClient = getAdminClient()
    
    // OPTIMIZATION: Determine target date/range from query params
    let startDateStr: string
    let endDateStr: string
    const startDateParam = c.req.query('startDate')
    const endDateParam = c.req.query('endDate')
    const dateParam = c.req.query('date')
    
    // Validate date format helper
    const isValidDateStr = (dateStr: string): boolean => {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/
      if (!dateRegex.test(dateStr)) return false
      const date = new Date(dateStr)
      return date.toISOString().split('T')[0] === dateStr
    }
    
    // Support date range (preferred way)
    if (startDateParam || endDateParam) {
      if (startDateParam && !isValidDateStr(startDateParam)) {
        return c.json({ error: 'Invalid startDate format. Use YYYY-MM-DD' }, 400)
      }
      if (endDateParam && !isValidDateStr(endDateParam)) {
        return c.json({ error: 'Invalid endDate format. Use YYYY-MM-DD' }, 400)
      }
      
      startDateStr = startDateParam || new Date().toISOString().split('T')[0]
      endDateStr = endDateParam || startDateStr
      
      // Ensure startDate <= endDate
      if (new Date(startDateStr) > new Date(endDateStr)) {
        return c.json({ error: 'startDate must be less than or equal to endDate' }, 400)
      }
    } 
    // Legacy: Single date support (for backward compatibility)
    else if (dateParam) {
      if (!isValidDateStr(dateParam)) {
        return c.json({ error: 'Invalid date format. Use YYYY-MM-DD' }, 400)
      }
      startDateStr = dateParam
      endDateStr = dateParam
    } 
    // Default to today
    else {
      const todayStr = new Date().toISOString().split('T')[0]
      startDateStr = todayStr
      endDateStr = todayStr
    }
    
    const startDate = new Date(startDateStr)
    const endDate = new Date(endDateStr)

    // Get team leader's team
    const { data: team, error: teamError } = await adminClient
      .from('teams')
      .select('id')
      .eq('team_leader_id', user.id)
      .single()

    if (teamError || !team) {
      return c.json({ error: 'Team not found' }, 404)
    }

    // Get all team members (workers only)
    const { data: teamMembers, error: membersError } = await adminClient
      .from('team_members')
      .select('user_id')
      .eq('team_id', team.id)

    if (membersError) {
      console.error('Error fetching team members:', membersError)
      return c.json({ error: 'Failed to fetch team members', details: membersError.message }, 500)
    }

    const workerIds = (teamMembers || []).map((m: any) => m.user_id)

    if (workerIds.length === 0) {
      return c.json({
        checkIns: [],
        statistics: {
          total: 0,
          completed: 0,
          pending: 0,
          green: 0,
          amber: 0,
          red: 0,
          completionRate: 0,
        },
        dateRange: {
          startDate: startDateStr,
          endDate: endDateStr,
          isSingleDate: startDateStr === endDateStr,
        },
      })
    }

    // Check if single date or date range
    const isSingleDate = startDateStr === endDateStr

    // Filter: Include workers who either:
    // 1. Have assigned schedules for the selected date(s) (single-date OR recurring), OR
    // 2. Have check-ins for the selected date(s) (preserve historical records), OR
    // 3. Have active exceptions in the date range (ensures workers with exceptions appear even if schedules are deactivated)
    
    // Date range for overlap calculations
    const rangeStart = new Date(startDateStr)
    const rangeEnd = new Date(endDateStr)
    rangeEnd.setHours(23, 59, 59, 999)
    
    // FIRST: Get all exceptions for team members to determine which workers to include
    const { data: allExceptionsRaw, error: exceptionsError } = await adminClient
      .from('worker_exceptions')
      .select('user_id, exception_type, reason, start_date, end_date, is_active, deactivated_at')
      .in('user_id', workerIds)
    
    if (exceptionsError) {
      console.error('[GET /teams/check-ins] Error fetching exceptions:', exceptionsError)
      // Continue anyway, just won't include workers based on exceptions
    }
    
    // Find workers with active exceptions in the date range
    const workersWithExceptionsInRange = new Set<string>()
    if (allExceptionsRaw) {
      allExceptionsRaw.forEach((exception: any) => {
        const exceptionStart = new Date(exception.start_date)
        const exceptionEnd = exception.end_date ? new Date(exception.end_date) : null
        
        // Check if exception overlaps with date range
        if (exceptionStart <= rangeEnd && (!exceptionEnd || exceptionEnd >= rangeStart)) {
          // Exception is active if is_active is true OR if it was deactivated after the range start
          let isActiveInRange = exception.is_active === true
          
          // If exception was deactivated, check if it was active during any part of the date range
          if (!isActiveInRange && exception.deactivated_at) {
            const deactivatedDate = new Date(exception.deactivated_at)
            // If deactivated after range start, it was active during part of the range
            if (deactivatedDate >= rangeStart) {
              isActiveInRange = true
            }
          }
          
          if (isActiveInRange) {
            workersWithExceptionsInRange.add(exception.user_id)
          }
        }
      })
    }
    
    // Get all worker schedules (both single-date and recurring)
    // Supports the new worker schedule logic
    const { data: allSchedules } = await adminClient
      .from('worker_schedules')
      .select('worker_id, scheduled_date, day_of_week, effective_date, expiry_date, is_active')
      .eq('team_id', team.id)
    
    // Get check-ins in the date range
    const { data: checkInsInRange } = await adminClient
      .from('daily_checkins')
      .select('user_id')
      .in('user_id', workerIds)
      .gte('check_in_date', startDateStr)
      .lte('check_in_date', endDateStr)
    
    // Find workers with schedules that overlap with the date range (supports both single-date and recurring)
    const workersWithSchedules = new Set<string>()
    
    ;(allSchedules || []).forEach((schedule: any) => {
      // Only count ACTIVE schedules
      if (!schedule.is_active) return
      
      // Single-date schedule: check if date is within range
      if (schedule.scheduled_date && !schedule.day_of_week) {
        const scheduleDate = new Date(schedule.scheduled_date)
        if (scheduleDate >= rangeStart && scheduleDate <= rangeEnd) {
          workersWithSchedules.add(schedule.worker_id)
        }
      }
      // Recurring schedule: check if date range overlaps with effective_date to expiry_date
      else if (schedule.day_of_week !== null && schedule.day_of_week !== undefined) {
        const effectiveDate = schedule.effective_date ? new Date(schedule.effective_date) : null
        const expiryDate = schedule.expiry_date ? new Date(schedule.expiry_date) : null
        expiryDate?.setHours(23, 59, 59, 999)
        
        // Check if schedule range overlaps with query range
        const scheduleEnds = expiryDate || new Date('2099-12-31')
        const scheduleStarts = effectiveDate || rangeStart
        
        if (scheduleStarts <= rangeEnd && scheduleEnds >= rangeStart) {
          workersWithSchedules.add(schedule.worker_id)
        }
      }
    })
    
    const workersWithCheckIns = Array.from(new Set((checkInsInRange || []).map((c: any) => c.user_id)))
    
    // Combine: workers with schedules OR workers with check-ins OR workers with exceptions
    // This preserves all historical data and ensures workers with exceptions still appear
    const activeWorkerIdsSet = new Set([
      ...Array.from(workersWithSchedules), 
      ...workersWithCheckIns,
      ...Array.from(workersWithExceptionsInRange)
    ])
    
    // Filter workerIds to only include those with schedules OR check-ins OR exceptions
    const filteredWorkerIds = workerIds.filter((id: string) => activeWorkerIdsSet.has(id))

    if (filteredWorkerIds.length === 0) {
      return c.json({
        checkIns: [],
        statistics: {
          total: 0,
          completed: 0,
          pending: 0,
          green: 0,
          amber: 0,
          red: 0,
          completionRate: 0,
        },
        dateRange: {
          startDate: startDateStr,
          endDate: endDateStr,
          isSingleDate,
        },
      })
    }

    // Use filtered worker IDs (only workers with assigned schedules)
    const activeWorkerIds = filteredWorkerIds

    // OPTIMIZATION: Build date range queries - if single date, use eq for better performance
    let checkInsQuery = adminClient
      .from('daily_checkins')
      .select('user_id, check_in_date, check_in_time, pain_level, fatigue_level, stress_level, sleep_quality, predicted_readiness, additional_notes, shift_type, shift_start_time, shift_end_time')
      .in('user_id', activeWorkerIds)
    
    let warmUpsQuery = adminClient
      .from('warm_ups')
      .select('user_id, warm_up_date, completed')
      .eq('completed', true)
      .in('user_id', activeWorkerIds)
    
    if (isSingleDate) {
      // Single date - use eq for better query performance
      checkInsQuery = checkInsQuery.eq('check_in_date', startDateStr)
      warmUpsQuery = warmUpsQuery.eq('warm_up_date', startDateStr)
    } else {
      // Date range - use gte and lte
      checkInsQuery = checkInsQuery.gte('check_in_date', startDateStr).lte('check_in_date', endDateStr)
      warmUpsQuery = warmUpsQuery.gte('warm_up_date', startDateStr).lte('warm_up_date', endDateStr)
    }

    // Parallel fetch: user details, check-ins, and warm-ups
    // OPTIMIZATION: Reuse allExceptionsRaw already fetched above instead of fetching again
    const [
      { data: allUsers },
      { data: allCheckIns },
      { data: allWarmUps },
    ] = await Promise.all([
      adminClient
        .from('users')
        .select('id, email, first_name, last_name, full_name')
        .eq('role', 'worker')
        .in('id', activeWorkerIds),
      checkInsQuery,
      warmUpsQuery,
    ])
    
    // Reuse allExceptionsRaw already fetched above, but filter to only activeWorkerIds
    // Keep deactivated_at for isExceptionActive function to work correctly
    const allExceptions = (allExceptionsRaw || [])
      .filter((exc: any) => activeWorkerIds.includes(exc.user_id))

    // Helper: Check if exception is active for a given date
    // Note: This endpoint only fetches active exceptions (is_active = true), 
    // but we still check deactivated_at for consistency and edge cases
    const isExceptionActive = (exception: { start_date: string; end_date?: string | null; deactivated_at?: string | null }, checkDate: Date) => {
      // If exception was deactivated before checkDate, it's not active
      if (exception.deactivated_at) {
        const deactivatedDate = new Date(exception.deactivated_at)
        deactivatedDate.setHours(0, 0, 0, 0)
        checkDate.setHours(0, 0, 0, 0)
        if (deactivatedDate < checkDate || deactivatedDate.getTime() === checkDate.getTime()) {
          return false
        }
      }
      
      const excStartDate = new Date(exception.start_date)
      const excEndDate = exception.end_date ? new Date(exception.end_date) : null
      return checkDate >= excStartDate && (!excEndDate || checkDate <= excEndDate)
    }
    
    // For date ranges, we need to determine which date to use for exception checking
    // Use endDate for exception checking (most recent date)
    const exceptionCheckDate = endDate

    // Filter active exceptions for the end date (or single date)
    const activeExceptions = (allExceptions || []).filter((exc: any) => isExceptionActive(exc, exceptionCheckDate))
    const workersWithExceptions = new Set(activeExceptions.map((e: any) => e.user_id))

    // OPTIMIZATION: For date ranges, group check-ins by date and get latest for each worker
    // For single date, just use the check-in directly
    let checkInsMap = new Map()
    let warmUpsMap = new Map()
    
    if (isSingleDate) {
      // Single date - simple mapping
      checkInsMap = new Map((allCheckIns || []).map((c: any) => [c.user_id, c]))
      warmUpsMap = new Map((allWarmUps || []).map((w: any) => [w.user_id, true]))
    } else {
      // Date range - get latest check-in and warm-up for each worker
      const checkInsByUser = new Map()
      const warmUpsByUser = new Map()
      
      // Group check-ins by user and keep the latest date
      ;(allCheckIns || []).forEach((c: any) => {
        const existing = checkInsByUser.get(c.user_id)
        if (!existing || c.check_in_date > existing.check_in_date) {
          checkInsByUser.set(c.user_id, c)
        }
      })
      
      // Group warm-ups by user
      ;(allWarmUps || []).forEach((w: any) => {
        warmUpsByUser.set(w.user_id, true)
      })
      
      checkInsMap = checkInsByUser
      warmUpsMap = warmUpsByUser
    }
    
    const exceptionsMap = new Map(activeExceptions.map((e: any) => [e.user_id, e]))

    // Build check-in data for each worker
    const checkIns = (allUsers || []).map((worker: any) => {
      const checkIn = checkInsMap.get(worker.id)
      const warmUpComplete = warmUpsMap.get(worker.id) || false
      const exception = exceptionsMap.get(worker.id)
      const hasActiveException = !!exception

      // Determine status
      let status: 'green' | 'amber' | 'red' | 'pending' | 'exception' = 'pending'
      if (hasActiveException) {
        status = 'exception'
      } else if (checkIn) {
        if (checkIn.predicted_readiness === 'Green') {
          status = 'green'
        } else if (checkIn.predicted_readiness === 'Yellow') {
          status = 'amber'
        } else if (checkIn.predicted_readiness === 'Red') {
          status = 'red'
        }
      }

      const workerName = worker.full_name || 
                        (worker.first_name && worker.last_name 
                          ? `${worker.first_name} ${worker.last_name}` 
                          : worker.email.split('@')[0])

      return {
        userId: worker.id,
        workerName,
        workerEmail: worker.email,
        workerInitials: workerName
          .split(' ')
          .map((n: string) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2),
        hasCheckedIn: !!checkIn,
        hasWarmUp: warmUpComplete,
        hasActiveException,
        exception: exception ? {
          type: exception.exception_type,
          reason: exception.reason,
          startDate: exception.start_date,
          endDate: exception.end_date,
        } : null,
        status,
        checkIn: checkIn ? {
          checkInTime: checkIn.check_in_time,
          painLevel: checkIn.pain_level,
          fatigueLevel: checkIn.fatigue_level,
          stressLevel: checkIn.stress_level,
          sleepQuality: checkIn.sleep_quality,
          predictedReadiness: checkIn.predicted_readiness,
          additionalNotes: checkIn.additional_notes,
          shiftType: checkIn.shift_type,
          shiftStartTime: checkIn.shift_start_time,
          shiftEndTime: checkIn.shift_end_time,
        } : null,
      }
    })

    // Calculate statistics (exclude workers with exceptions from totals)
    const activeWorkers = checkIns.filter(c => !c.hasActiveException)
    const completed = activeWorkers.filter(c => c.hasCheckedIn).length
    const pending = activeWorkers.length - completed
    const green = activeWorkers.filter(c => c.status === 'green').length
    const amber = activeWorkers.filter(c => c.status === 'amber').length
    const red = activeWorkers.filter(c => c.status === 'red').length
    const completionRate = activeWorkers.length > 0 
      ? Math.round((completed / activeWorkers.length) * 100) 
      : 0

    // Set no-cache headers to ensure fresh data
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    c.header('Pragma', 'no-cache')
    c.header('Expires', '0')

    return c.json({
      checkIns,
      statistics: {
        total: activeWorkers.length,
        completed,
        pending,
        green,
        amber,
        red,
        completionRate,
        withExceptions: checkIns.filter(c => c.hasActiveException).length,
      },
      dateRange: {
        startDate: startDateStr,
        endDate: endDateStr,
        isSingleDate,
      },
    })
  } catch (error: any) {
    console.error('Get team check-ins error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get team check-in analytics with filtering (team leader only)
// Uses caching for improved performance
teams.get('/check-ins/analytics', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    if (user.role !== 'team_leader') {
      console.warn(`[GET /teams/check-ins/analytics] SECURITY: User ${user.id} (${user.email}) with role '${user.role}' attempted to access team-leader-only endpoint. Access denied.`)
      return c.json({ error: 'Forbidden: This endpoint is only accessible to team leaders' }, 403)
    }

    // Import cache utility
    const { cache, CacheManager } = await import('../utils/cache')
    
    // Get date filters from query params
    const startDate = c.req.query('startDate') || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
    const endDate = c.req.query('endDate') || new Date().toISOString().split('T')[0]
    const workerIdsParam = c.req.query('workerIds')
    const workerIds = workerIdsParam ? workerIdsParam.split(',') : null

    // Generate cache key
    const cacheKey = CacheManager.generateKey('analytics', {
      userId: user.id,
      startDate,
      endDate,
      workerIds: workerIds?.join(',') || 'all',
    })

    // Try to get from cache (5 minute TTL)
    const cached = cache.get(cacheKey)
    if (cached) {
      return c.json(cached, 200, {
        'X-Cache': 'HIT',
        'Cache-Control': 'public, max-age=300',
      })
    }

    const adminClient = getAdminClient()

    // Get team leader's team
    const { data: team, error: teamError } = await adminClient
      .from('teams')
      .select('id')
      .eq('team_leader_id', user.id)
      .single()

    if (teamError || !team) {
      return c.json({ error: 'Team not found' }, 404)
    }

    // Get all team members (workers only)
    const { data: teamMembers, error: membersError } = await adminClient
      .from('team_members')
      .select('user_id')
      .eq('team_id', team.id)

    if (membersError) {
      console.error('Error fetching team members:', membersError)
      return c.json({ error: 'Failed to fetch team members', details: membersError.message }, 500)
    }

    let allWorkerIds = (teamMembers || []).map((m: any) => m.user_id)
    
    // Filter by workerIds if provided
    if (workerIds && workerIds.length > 0) {
      allWorkerIds = allWorkerIds.filter((id: string) => workerIds.includes(id))
    }

    // IMPORTANT: Include workers who either:
    // 1. Have assigned schedules in the date range (single-date OR recurring), OR
    // 2. Have check-ins in the date range (historical records should be preserved in analytics), OR
    // 3. Have active exceptions in the date range (ensures workers with exceptions appear even if schedules are deactivated)
    
    // Date range for overlap calculations
    const rangeStart = new Date(startDate)
    const rangeEnd = new Date(endDate)
    rangeEnd.setHours(23, 59, 59, 999)
    
    // FIRST: Get all exceptions for team members to determine which workers to include
    // We need this BEFORE filtering workers because exceptions determine if a worker should appear
    const { data: allExceptionsRaw, error: exceptionsError } = await adminClient
      .from('worker_exceptions')
      .select('user_id, exception_type, reason, start_date, end_date, is_active, deactivated_at')
      .in('user_id', allWorkerIds)
    
    if (exceptionsError) {
      console.error('Error fetching exceptions:', exceptionsError)
      // Continue anyway, just won't include workers based on exceptions
    }
    
    // Find workers with active exceptions in the date range
    const workersWithExceptionsInRange = new Set<string>()
    if (allExceptionsRaw) {
      allExceptionsRaw.forEach((exception: any) => {
        const exceptionStart = new Date(exception.start_date)
        const exceptionEnd = exception.end_date ? new Date(exception.end_date) : null
        
        // Check if exception overlaps with date range
        if (exceptionStart <= rangeEnd && (!exceptionEnd || exceptionEnd >= rangeStart)) {
          // Exception is active if is_active is true OR if it was deactivated after the range start
          let isActiveInRange = exception.is_active === true
          
          // If exception was deactivated, check if it was active during any part of the date range
          if (!isActiveInRange && exception.deactivated_at) {
            const deactivatedDate = new Date(exception.deactivated_at)
            // If deactivated after range start, it was active during part of the range
            if (deactivatedDate >= rangeStart) {
              isActiveInRange = true
            }
          }
          
          if (isActiveInRange) {
            workersWithExceptionsInRange.add(exception.user_id)
          }
        }
      })
    }
    
    // Get all worker schedules (both single-date and recurring)
    // Include BOTH active AND inactive schedules for historical analytics accuracy
    // Inactive schedules are soft-deleted but needed for completion rate calculation
    const { data: allSchedules } = await adminClient
      .from('worker_schedules')
      .select('worker_id, scheduled_date, day_of_week, effective_date, expiry_date, is_active')
      .eq('team_id', team.id)
    
    const { data: checkInsInRange } = await adminClient
      .from('daily_checkins')
      .select('user_id')
      .in('user_id', allWorkerIds)
      .gte('check_in_date', startDate)
      .lte('check_in_date', endDate)
    
    // Find workers with schedules that overlap with the date range
    const workersWithSchedules = new Set<string>()
    
    ;(allSchedules || []).forEach((schedule: any) => {
      // Single-date schedule: check if date is within range
      if (schedule.scheduled_date && !schedule.day_of_week) {
        const scheduleDate = new Date(schedule.scheduled_date)
        if (scheduleDate >= rangeStart && scheduleDate <= rangeEnd) {
          workersWithSchedules.add(schedule.worker_id)
        }
      }
      // Recurring schedule: check if date range overlaps with effective_date to expiry_date
      else if (schedule.day_of_week !== null && schedule.day_of_week !== undefined) {
        const effectiveDate = schedule.effective_date ? new Date(schedule.effective_date) : null
        const expiryDate = schedule.expiry_date ? new Date(schedule.expiry_date) : null
        expiryDate?.setHours(23, 59, 59, 999)
        
        // Check if schedule range overlaps with query range
        const scheduleEnds = expiryDate || new Date('2099-12-31')
        const scheduleStarts = effectiveDate || rangeStart
        
        if (scheduleStarts <= rangeEnd && scheduleEnds >= rangeStart) {
          workersWithSchedules.add(schedule.worker_id)
        }
      }
    })
    
    const workersWithCheckIns = Array.from(new Set((checkInsInRange || []).map((c: any) => c.user_id)))
    
    // Combine: workers with schedules OR workers with check-ins OR workers with exceptions
    // This preserves all historical data and ensures workers with exceptions still appear
    const activeWorkerIdsSet = new Set([
      ...Array.from(workersWithSchedules), 
      ...workersWithCheckIns,
      ...Array.from(workersWithExceptionsInRange)
    ])
    
    // Filter to only workers with assigned schedules OR check-ins OR exceptions
    allWorkerIds = allWorkerIds.filter((id: string) => activeWorkerIdsSet.has(id))

    if (allWorkerIds.length === 0) {
      return c.json({
        summary: {
          totalCheckIns: 0,
          completionRate: 0,
          avgReadiness: { green: 0, amber: 0, red: 0 },
          onTimeRate: 0,
          trend: { completion: '0%', readiness: '0%' },
        },
        dailyTrends: [],
        workerStats: [],
        weeklyPattern: {},
        healthMetrics: {
          avgPain: 0,
          avgFatigue: 0,
          avgStress: 0,
          avgSleep: 0,
        },
      })
    }

    // Get user details for all workers
    const { data: users } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name, full_name')
      .in('id', allWorkerIds)

    const userMap = new Map((users || []).map((u: any) => [u.id, u]))

    // Filter exceptions to only include those that overlap with the selected date range
    // Note: allExceptionsRaw is already fetched above, and rangeStart/rangeEnd are already declared
    const allExceptions = (allExceptionsRaw || []).filter((exception: any) => {
      const exceptionStart = new Date(exception.start_date)
      const exceptionEnd = exception.end_date ? new Date(exception.end_date) : null
      
      // Exception overlaps with date range if:
      // - Exception starts before or on range end
      // - Exception ends after or on range start (or has no end date)
      return exceptionStart <= rangeEnd && (!exceptionEnd || exceptionEnd >= rangeStart)
    })

    // Helper function to check if exception is active on a specific date
    // This uses deactivated_at timestamp to ensure historical accuracy
    const isExceptionActiveOnDate = (exception: { start_date: string; end_date?: string | null; deactivated_at?: string | null }, checkDate: Date): boolean => {
      // If exception was deactivated, check if deactivation was before or on the checkDate
      if (exception.deactivated_at) {
        const deactivatedDate = new Date(exception.deactivated_at)
        deactivatedDate.setHours(0, 0, 0, 0)
        checkDate.setHours(0, 0, 0, 0)
        // If deactivated before or on checkDate, exception was not active on that date
        if (deactivatedDate < checkDate) {
          return false
        }
        // If deactivated on the same day, we need to check if it was active during that day
        // For simplicity, if deactivated on the same day, consider it inactive for analytics
        if (deactivatedDate.getTime() === checkDate.getTime()) {
          return false
        }
      }
      
      // Check date range overlap
      const startDate = new Date(exception.start_date)
      startDate.setHours(0, 0, 0, 0)
      const endDate = exception.end_date ? new Date(exception.end_date) : null
      if (endDate) endDate.setHours(23, 59, 59, 999)
      checkDate.setHours(0, 0, 0, 0)
      return checkDate >= startDate && (!endDate || checkDate <= endDate)
    }

    // Create a map of exceptions by user_id for quick lookup
    const exceptionsByWorker = new Map<string, any[]>()
    if (allExceptions) {
      allExceptions.forEach((exception: any) => {
        const workerId = exception.user_id
        if (!exceptionsByWorker.has(workerId)) {
          exceptionsByWorker.set(workerId, [])
        }
        exceptionsByWorker.get(workerId)!.push(exception)
      })
    }

    // Get check-ins for the date range
    const { data: checkIns, error: checkInsError } = await adminClient
      .from('daily_checkins')
      .select('*')
      .in('user_id', allWorkerIds)
      .gte('check_in_date', startDate)
      .lte('check_in_date', endDate)
      .order('check_in_date', { ascending: true })

    if (checkInsError) {
      console.error('Error fetching check-ins:', checkInsError)
      return c.json({ error: 'Failed to fetch check-ins', details: checkInsError.message }, 500)
    }

    // Calculate total expected check-ins based on scheduled days
    // Account for both single-date AND recurring schedules
    // IMPORTANT: Include BOTH active and inactive schedules for historical accuracy
    // This ensures that when a schedule is deleted, past check-ins still count correctly
    const start = new Date(startDate)
    const end = new Date(endDate)
    
    // Reuse allSchedules already fetched above, but filter to only active worker IDs
    // For completion rate calculation, we only count ACTIVE schedules
    // Historical data (inactive schedules) should not count toward expected check-ins
    const filteredSchedules = (allSchedules || []).filter((s: any) => 
      allWorkerIds.includes(s.worker_id) && s.is_active === true
    )
    
    // Create a map: date -> set of worker IDs with schedules on that date
    // Only includes ACTIVE schedules for accurate completion rate calculation
    const schedulesByDate = new Map<string, Set<string>>()
    
    // Process schedules to build the date map (only ACTIVE schedules count toward expected check-ins)
    filteredSchedules.forEach((schedule: any) => {
      // Single-date schedule
      if (schedule.scheduled_date && (schedule.day_of_week === null || schedule.day_of_week === undefined)) {
        const scheduleDate = new Date(schedule.scheduled_date)
        if (scheduleDate >= start && scheduleDate <= end) {
          const dateStr = schedule.scheduled_date
          if (!schedulesByDate.has(dateStr)) {
            schedulesByDate.set(dateStr, new Set())
          }
          schedulesByDate.get(dateStr)!.add(schedule.worker_id)
        }
      }
      // Recurring schedule: calculate all matching dates
      else if (schedule.day_of_week !== null && schedule.day_of_week !== undefined) {
        const effectiveDate = schedule.effective_date ? new Date(schedule.effective_date) : start
        const expiryDate = schedule.expiry_date ? new Date(schedule.expiry_date) : end
        expiryDate.setHours(23, 59, 59, 999)
        
        const scheduleStart = effectiveDate > start ? effectiveDate : start
        const scheduleEnd = expiryDate < end ? expiryDate : end
        
        // Calculate all dates that match the day_of_week within the effective range
        for (let d = new Date(scheduleStart); d <= scheduleEnd; d.setDate(d.getDate() + 1)) {
          const dayOfWeek = d.getDay() // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
          
          // Check if this date matches the schedule's day_of_week
          if (dayOfWeek === schedule.day_of_week) {
            const dateStr = d.toISOString().split('T')[0]
            if (!schedulesByDate.has(dateStr)) {
              schedulesByDate.set(dateStr, new Set())
            }
            schedulesByDate.get(dateStr)!.add(schedule.worker_id)
          }
        }
      }
    })
    
    // Count expected check-ins per day: only workers with schedules AND no exceptions
    let totalExpectedCheckIns = 0
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0]
      const checkDate = new Date(dateStr)
      
      // Get workers with schedules on this date
      const workersWithScheduleOnDate = schedulesByDate.get(dateStr) || new Set()
      
      // Count workers with schedule AND without exceptions on this date
      const activeWorkersOnDate = Array.from(workersWithScheduleOnDate).filter(workerId => {
        const workerExceptions = exceptionsByWorker.get(workerId) || []
        // Worker is active if they have no exceptions OR no exception is active on this date
        return !workerExceptions.some(exception => isExceptionActiveOnDate(exception, checkDate))
      })
      
      totalExpectedCheckIns += activeWorkersOnDate.length
    }

    // Filter check-ins: exclude check-ins from workers who had exceptions on that date
    const validCheckIns = (checkIns || []).filter((checkIn: any) => {
      const checkInDate = new Date(checkIn.check_in_date)
      const workerExceptions = exceptionsByWorker.get(checkIn.user_id) || []
      // Check-in is valid if worker had no exception active on that date
      return !workerExceptions.some(exception => isExceptionActiveOnDate(exception, checkInDate))
    })

    // Calculate summary statistics (only using valid check-ins)
    const totalCheckIns = validCheckIns.length
    const completionRate = totalExpectedCheckIns > 0 ? Math.round((totalCheckIns / totalExpectedCheckIns) * 100 * 10) / 10 : 0

    // Readiness distribution (only from valid check-ins)
    const green = validCheckIns.filter((c: any) => c.predicted_readiness === 'Green').length
    const amber = validCheckIns.filter((c: any) => c.predicted_readiness === 'Yellow' || c.predicted_readiness === 'Amber').length
    const red = validCheckIns.filter((c: any) => c.predicted_readiness === 'Red').length
    const totalReadiness = green + amber + red

    const avgReadiness = {
      green: totalReadiness > 0 ? Math.round((green / totalReadiness) * 100) : 0,
      amber: totalReadiness > 0 ? Math.round((amber / totalReadiness) * 100) : 0,
      red: totalReadiness > 0 ? Math.round((red / totalReadiness) * 100) : 0,
    }

    // Calculate daily trends
    const dailyTrendsMap = new Map<string, {
      date: string
      completed: number
      pending: number
      green: number
      amber: number
      red: number
    }>()

    // Initialize all dates in range (count workers with schedules per day, excluding exceptions)
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0]
      const checkDate = new Date(dateStr)
      
      // Get workers with schedules on this date
      const workersWithScheduleOnDate = schedulesByDate.get(dateStr) || new Set()
      
      // Count workers with schedule AND without exceptions on this date
      const activeWorkersOnDate = Array.from(workersWithScheduleOnDate).filter(workerId => {
        const workerExceptions = exceptionsByWorker.get(workerId) || []
        return !workerExceptions.some(exception => isExceptionActiveOnDate(exception, checkDate))
      }).length
      
      dailyTrendsMap.set(dateStr, {
        date: dateStr,
        completed: 0,
        pending: activeWorkersOnDate, // Only count workers with schedules and without exceptions
        green: 0,
        amber: 0,
        red: 0,
      })
    }

    // Fill in check-in data (only valid check-ins)
    validCheckIns.forEach((checkIn: any) => {
      const dateStr = checkIn.check_in_date
      const dayData = dailyTrendsMap.get(dateStr)
      if (dayData) {
        dayData.completed++
        dayData.pending--
        if (checkIn.predicted_readiness === 'Green') dayData.green++
        else if (checkIn.predicted_readiness === 'Yellow' || checkIn.predicted_readiness === 'Amber') dayData.amber++
        else if (checkIn.predicted_readiness === 'Red') dayData.red++
      }
    })

    const dailyTrends = Array.from(dailyTrendsMap.values())

    // Worker statistics
    const workerStatsMap = new Map<string, {
      workerId: string
      name: string
      email: string
      totalCheckIns: number
      completionRate: number
      greenCount: number
      amberCount: number
      redCount: number
      avgReadiness: string
    }>()

    allWorkerIds.forEach((workerId: string) => {
      const user = userMap.get(workerId)
      const name = user?.full_name || `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || user?.email?.split('@')[0] || 'Unknown'
      workerStatsMap.set(workerId, {
        workerId,
        name,
        email: user?.email || '',
        totalCheckIns: 0,
        completionRate: 0,
        greenCount: 0,
        amberCount: 0,
        redCount: 0,
        avgReadiness: 'N/A',
      })
    })

    // Process valid check-ins for worker stats (exclude check-ins on exception days)
    validCheckIns.forEach((checkIn: any) => {
      const stats = workerStatsMap.get(checkIn.user_id)
      if (stats) {
        stats.totalCheckIns++
        if (checkIn.predicted_readiness === 'Green') stats.greenCount++
        else if (checkIn.predicted_readiness === 'Yellow' || checkIn.predicted_readiness === 'Amber') stats.amberCount++
        else if (checkIn.predicted_readiness === 'Red') stats.redCount++
      }
    })

    // Calculate completion rates and average readiness for each worker
    // For completion rate, count only days with assigned schedules (single-date OR recurring) AND without exceptions
    workerStatsMap.forEach((stats) => {
      const workerId = stats.workerId
      const workerExceptions = exceptionsByWorker.get(workerId) || []
      
      // Count days this worker had assigned schedule (from schedulesByDate map which includes both single-date and recurring) AND was active (without exceptions)
      let activeDaysForWorker = 0
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0]
        const checkDate = new Date(d)
        
        // Check if worker has schedule on this date (works for both single-date and recurring schedules)
        const hasScheduleOnDate = schedulesByDate.get(dateStr)?.has(workerId) || false
        if (!hasScheduleOnDate) continue // Skip days without assigned schedule
        
        // Check if worker has exception on this date
        const hasExceptionOnDate = workerExceptions.some(exception => isExceptionActiveOnDate(exception, checkDate))
        if (!hasExceptionOnDate) {
          activeDaysForWorker++
        }
      }
      
      stats.completionRate = activeDaysForWorker > 0 ? Math.round((stats.totalCheckIns / activeDaysForWorker) * 100) : 0
      const total = stats.greenCount + stats.amberCount + stats.redCount
      if (total > 0) {
        const greenPercent = (stats.greenCount / total) * 100
        if (greenPercent >= 70) stats.avgReadiness = 'Green'
        else if (greenPercent >= 40) stats.avgReadiness = 'Amber'
        else stats.avgReadiness = 'Red'
      }
    })

    const workerStats = Array.from(workerStatsMap.values())

    // Weekly pattern (day of week analysis)
    const weeklyPattern: Record<string, { avgReadiness: string; completion: number; green: number; amber: number; red: number }> = {}
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    dayNames.forEach(day => {
      weeklyPattern[day] = { avgReadiness: 'N/A', completion: 0, green: 0, amber: 0, red: 0 }
    })

    // Only count valid check-ins (excluding exception days) for weekly pattern
    validCheckIns.forEach((checkIn: any) => {
      const date = new Date(checkIn.check_in_date)
      const dayName = dayNames[date.getDay()]
      if (weeklyPattern[dayName]) {
        weeklyPattern[dayName].completion++
        if (checkIn.predicted_readiness === 'Green') weeklyPattern[dayName].green++
        else if (checkIn.predicted_readiness === 'Yellow' || checkIn.predicted_readiness === 'Amber') weeklyPattern[dayName].amber++
        else if (checkIn.predicted_readiness === 'Red') weeklyPattern[dayName].red++
      }
    })

    // Calculate average readiness for each day
    Object.keys(weeklyPattern).forEach(day => {
      const dayData = weeklyPattern[day]
      const total = dayData.green + dayData.amber + dayData.red
      if (total > 0) {
        const greenPercent = (dayData.green / total) * 100
        if (greenPercent >= 70) dayData.avgReadiness = 'Green'
        else if (greenPercent >= 40) dayData.avgReadiness = 'Amber'
        else dayData.avgReadiness = 'Red'
      }
    })

    // Calculate trends (compare with previous period)
    // Need to apply same exception filtering to previous period
    const prevStart = new Date(start)
    prevStart.setMonth(prevStart.getMonth() - 1)
    const prevEnd = new Date(end)
    prevEnd.setMonth(prevEnd.getMonth() - 1)
    
    const { data: prevCheckIns } = await adminClient
      .from('daily_checkins')
      .select('id, user_id, check_in_date, predicted_readiness')
      .in('user_id', allWorkerIds)
      .gte('check_in_date', prevStart.toISOString().split('T')[0])
      .lte('check_in_date', prevEnd.toISOString().split('T')[0])

    // Filter previous period check-ins (exclude exception days)
    const validPrevCheckIns = (prevCheckIns || []).filter((checkIn: any) => {
      const checkInDate = new Date(checkIn.check_in_date)
      const workerExceptions = exceptionsByWorker.get(checkIn.user_id) || []
      return !workerExceptions.some(exception => isExceptionActiveOnDate(exception, checkInDate))
    })

    // Get schedules for previous period (both single-date and recurring)
    const { data: prevSchedulesInRange } = await adminClient
      .from('worker_schedules')
      .select('worker_id, scheduled_date, day_of_week, effective_date, expiry_date')
      .eq('team_id', team.id)
      .in('worker_id', allWorkerIds)
      .eq('is_active', true)
    
    const prevSchedulesByDate = new Map<string, Set<string>>()
    
    // Process schedules for previous period
    ;(prevSchedulesInRange || []).forEach((schedule: any) => {
      // Single-date schedule
      if (schedule.scheduled_date && (schedule.day_of_week === null || schedule.day_of_week === undefined)) {
        const scheduleDate = new Date(schedule.scheduled_date)
        if (scheduleDate >= prevStart && scheduleDate <= prevEnd) {
          const dateStr = schedule.scheduled_date
          if (!prevSchedulesByDate.has(dateStr)) {
            prevSchedulesByDate.set(dateStr, new Set())
          }
          prevSchedulesByDate.get(dateStr)!.add(schedule.worker_id)
        }
      }
      // Recurring schedule: calculate all matching dates
      else if (schedule.day_of_week !== null && schedule.day_of_week !== undefined) {
        const effectiveDate = schedule.effective_date ? new Date(schedule.effective_date) : prevStart
        const expiryDate = schedule.expiry_date ? new Date(schedule.expiry_date) : prevEnd
        expiryDate.setHours(23, 59, 59, 999)
        
        const scheduleStart = effectiveDate > prevStart ? effectiveDate : prevStart
        const scheduleEnd = expiryDate < prevEnd ? expiryDate : prevEnd
        
        // Calculate all dates that match the day_of_week within the effective range
        for (let d = new Date(scheduleStart); d <= scheduleEnd; d.setDate(d.getDate() + 1)) {
          const dayOfWeek = d.getDay()
          
          if (dayOfWeek === schedule.day_of_week) {
            const dateStr = d.toISOString().split('T')[0]
            if (!prevSchedulesByDate.has(dateStr)) {
              prevSchedulesByDate.set(dateStr, new Set())
            }
            prevSchedulesByDate.get(dateStr)!.add(schedule.worker_id)
          }
        }
      }
    })
    
    // Calculate expected check-ins for previous period (only workers with schedules, excluding exceptions)
    let prevTotalExpected = 0
    for (let d = new Date(prevStart); d <= prevEnd; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0]
      const checkDate = new Date(dateStr)
      
      // Get workers with schedules on this date
      const prevWorkersWithScheduleOnDate = prevSchedulesByDate.get(dateStr) || new Set()
      
      // Count workers with schedule AND without exceptions
      const activeWorkersOnDate = Array.from(prevWorkersWithScheduleOnDate).filter(workerId => {
        const workerExceptions = exceptionsByWorker.get(workerId) || []
        return !workerExceptions.some(exception => isExceptionActiveOnDate(exception, checkDate))
      }).length
      
      prevTotalExpected += activeWorkersOnDate
    }

    const prevCompletionRate = prevTotalExpected > 0 ? (validPrevCheckIns.length / prevTotalExpected) * 100 : 0
    const completionTrend = completionRate - prevCompletionRate

    const prevGreen = validPrevCheckIns.filter((c: any) => c.predicted_readiness === 'Green').length
    const prevTotal = validPrevCheckIns.length
    const prevGreenPercent = prevTotal > 0 ? (prevGreen / prevTotal) * 100 : 0
    const currentGreenPercent = totalReadiness > 0 ? (green / totalReadiness) * 100 : 0
    const readinessTrend = currentGreenPercent - prevGreenPercent

    const responseData = {
      summary: {
        totalCheckIns,
        completionRate,
        avgReadiness,
        onTimeRate: 85, // Placeholder - can be calculated based on check-in window
        trend: {
          completion: `${completionTrend >= 0 ? '+' : ''}${Math.round(completionTrend * 10) / 10}%`,
          readiness: `${readinessTrend >= 0 ? '+' : ''}${Math.round(readinessTrend * 10) / 10}%`,
        },
      },
      dailyTrends,
      workerStats,
      weeklyPattern,
    }

    // Store in cache (5 minute TTL)
    cache.set(cacheKey, responseData, 5 * 60 * 1000)

    return c.json(responseData, 200, {
      'X-Cache': 'MISS',
      'Cache-Control': 'public, max-age=300',
    })
  } catch (error: any) {
    console.error('Get check-in analytics error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Verify password for accessing logs (team leader only)
teams.post('/logs/verify-password', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    if (user.role !== 'team_leader') {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const { password } = await c.req.json()

    if (!password || typeof password !== 'string' || password.trim() === '') {
      return c.json({ error: 'Password is required' }, 400)
    }

    const adminClient = getAdminClient()

    // Get team leader's email and password hash
    const { data: teamLeaderUser, error: userError } = await adminClient
      .from('users')
      .select('email, password_hash')
      .eq('id', user.id)
      .single()

    if (userError || !teamLeaderUser) {
      console.error('[POST /teams/logs/verify-password] Error fetching user:', userError)
      return c.json({ error: 'Failed to verify identity' }, 500)
    }

    let passwordValid = false

    if (teamLeaderUser.password_hash) {
      // Verify using stored password hash
      passwordValid = await bcrypt.compare(password, teamLeaderUser.password_hash)
    } else {
      // If no password_hash, verify using Supabase Auth
      try {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: teamLeaderUser.email,
          password: password,
        })
        passwordValid = !signInError
        // Sign out immediately to prevent session creation
        if (passwordValid) {
          await supabase.auth.signOut()
        }
      } catch (authError: any) {
        console.error('[POST /teams/logs/verify-password] Password verification error:', authError)
        passwordValid = false
      }
    }

    if (!passwordValid) {
      return c.json({ error: 'Invalid password' }, 401)
    }

    return c.json({ verified: true })
  } catch (error: any) {
    console.error('[POST /teams/logs/verify-password] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get team member login logs (team leader only)
teams.get('/logs', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Verify user is actually a team leader
    if (user.role !== 'team_leader') {
      return c.json({ error: 'Forbidden: This endpoint is only accessible to team leaders' }, 403)
    }

    // Support both cursor and offset-based pagination (backward compatible)
    const cursor = c.req.query('cursor')
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : undefined
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100)
    const useCursor = cursor !== undefined || page === undefined

    // Validate pagination
    if (limit < 1 || limit > 100) {
      return c.json({ error: 'Invalid pagination parameters. Limit must be between 1 and 100' }, 400)
    }
    if (page !== undefined && (page < 1)) {
      return c.json({ error: 'Invalid pagination parameters. Page must be >= 1' }, 400)
    }

    const adminClient = getAdminClient()

    // Get team leader's team
    const { data: team, error: teamError } = await adminClient
      .from('teams')
      .select('id')
      .eq('team_leader_id', user.id)
      .single()

    if (teamError || !team) {
      return c.json({ error: 'Team not found' }, 404)
    }

    // Get team members
    const { data: teamMembers, error: membersError } = await adminClient
      .from('team_members')
      .select('user_id')
      .eq('team_id', team.id)

    if (membersError) {
      console.error('[GET /teams/logs] Error fetching team members:', membersError)
      return c.json({ error: 'Failed to fetch team members', details: membersError.message }, 500)
    }

    const teamMemberIds = (teamMembers || []).map((tm: any) => tm.user_id)

    if (teamMemberIds.length === 0) {
      return c.json({
        logs: [],
        pagination: {
          page: 1,
          limit,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        },
      })
    }

    // Get paginated login logs using cursor or offset-based pagination
    let logs: any[] = []
    let logsError: any = null
    let count: number | null = null
    let hasMore = false
    
    if (useCursor) {
      // Cursor-based pagination (more efficient for large datasets)
      const { decodeCursor, encodeCursor } = await import('../utils/pagination')
      
      // Decode cursor if provided
      let cursorFilter = adminClient
        .from('login_logs')
        .select(`
          id,
          user_id,
          email,
          role,
          login_at,
          user_agent,
          created_at,
          users:user_id(
            id,
            email,
            first_name,
            last_name,
            full_name
          )
        `)
        .in('user_id', teamMemberIds)
        .order('login_at', { ascending: false })
      
      if (cursor) {
        const decoded = decodeCursor(cursor)
        if (decoded) {
          const cursorDate = decoded.loginAt || decoded.login_at || decoded.createdAt || decoded.created_at
          if (cursorDate) {
            cursorFilter = cursorFilter.lt('login_at', cursorDate)
          }
        }
      }
      
      // Fetch limit + 1 to check if there's more
      const { data: logsData, error: logsErr } = await cursorFilter.limit(limit + 1)
      
      logs = logsData || []
      logsError = logsErr
      hasMore = logs.length > limit
      
      // Remove extra item if we got one
      if (hasMore) {
        logs = logs.slice(0, limit)
      }
    } else {
      // Offset-based pagination (backward compatible)
      const offset = ((page || 1) - 1) * limit
      
      // Get total count for pagination
      const { count: totalCount, error: countError } = await adminClient
        .from('login_logs')
        .select('*', { count: 'exact', head: true })
        .in('user_id', teamMemberIds)

      if (countError) {
        console.error('[GET /teams/logs] Error counting logs:', countError)
        return c.json({ error: 'Failed to count logs', details: countError.message }, 500)
      }
      
      count = totalCount || 0

      // Get paginated login logs
      const { data: logsData, error: logsErr } = await adminClient
        .from('login_logs')
        .select(`
          id,
          user_id,
          email,
          role,
          login_at,
          user_agent,
          created_at,
          users:user_id(
            id,
            email,
            first_name,
            last_name,
            full_name
          )
        `)
        .in('user_id', teamMemberIds)
        .order('login_at', { ascending: false })
        .range(offset, offset + limit - 1)
      
      logs = logsData || []
      logsError = logsErr
    }

    if (logsError) {
      console.error('[GET /teams/logs] Error fetching logs:', logsError)
      return c.json({ error: 'Failed to fetch logs', details: logsError.message }, 500)
    }

    // Format logs with user info
    const formattedLogs = (logs || []).map((log: any) => {
      const userInfo = Array.isArray(log.users) ? log.users[0] : log.users
      return {
        id: log.id,
        userId: log.user_id,
        email: log.email,
        role: log.role,
        loginAt: log.login_at,
        userAgent: log.user_agent,
        userName: userInfo?.full_name || 
                 (userInfo?.first_name && userInfo?.last_name 
                   ? `${userInfo.first_name} ${userInfo.last_name}`
                   : userInfo?.email || log.email),
        userEmail: userInfo?.email || log.email,
      }
    })

    // Build pagination response
    let paginationResponse: any
    
    if (useCursor) {
      // Cursor-based pagination response
      const { encodeCursor } = await import('../utils/pagination')
      
      let nextCursor: string | undefined = undefined
      if (hasMore && formattedLogs.length > 0) {
        const lastItem = logs[logs.length - 1]
        nextCursor = encodeCursor({
          id: lastItem.id,
          loginAt: lastItem.login_at,
          createdAt: lastItem.created_at,
        })
      }
      
      paginationResponse = {
        limit,
        hasNext: hasMore,
        hasPrev: !!cursor,
        nextCursor,
        prevCursor: cursor || undefined,
      }
    } else {
      // Offset-based pagination response (backward compatible)
      const totalPages = Math.ceil((count || 0) / limit)
      paginationResponse = {
        page: page || 1,
        limit,
        total: count || 0,
        totalPages,
        hasNext: (page || 1) < totalPages,
        hasPrev: (page || 1) > 1,
      }
    }

    // Add cache-control headers to prevent caching
    return c.json({
      logs: formattedLogs,
      pagination: paginationResponse,
    }, 200, {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    })
  } catch (error: any) {
    console.error('[GET /teams/logs] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// ============================================
// Notifications Endpoints for Team Leaders
// ============================================

// Get notifications for Team Leader
teams.get('/notifications', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    if (user.role !== 'team_leader') {
      return c.json({ error: 'Forbidden: This endpoint is only accessible to team leaders' }, 403)
    }

    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200) // Max 200 notifications
    const unreadOnly = c.req.query('unread_only') === 'true'

    const adminClient = getAdminClient()

    // SECURITY: Only fetch notifications belonging to the authenticated team leader
    let query = adminClient
      .from('notifications')
      .select('*')
      .eq('user_id', user.id) // Critical: Only get user's own notifications
      .order('created_at', { ascending: false })
      .limit(limit)

    if (unreadOnly) {
      query = query.eq('is_read', false)
    }

    const { data: notifications, error } = await query

    if (error) {
      console.error('[GET /teams/notifications] Error:', error)
      return c.json({ error: 'Failed to fetch notifications', details: error.message }, 500)
    }

    // Count unread notifications
    const { count: unreadCount, error: countError } = await adminClient
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false)

    if (countError) {
      console.error('[GET /teams/notifications] Error counting unread:', countError)
    }

    return c.json({
      notifications: notifications || [],
      unreadCount: unreadCount || 0,
    })
  } catch (error: any) {
    console.error('[GET /teams/notifications] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Mark notification as read (Team Leader)
teams.patch('/notifications/:notificationId/read', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    if (user.role !== 'team_leader') {
      return c.json({ error: 'Forbidden: This endpoint is only accessible to team leaders' }, 403)
    }

    const notificationId = c.req.param('notificationId')
    const adminClient = getAdminClient()

    // Verify notification belongs to user
    const { data: notification, error: fetchError } = await adminClient
      .from('notifications')
      .select('id, is_read')
      .eq('id', notificationId)
      .eq('user_id', user.id) // Critical: Only allow reading own notifications
      .single()

    if (fetchError || !notification) {
      return c.json({ error: 'Notification not found' }, 404)
    }

    if (notification.is_read) {
      return c.json({ message: 'Notification already read' })
    }

    // Mark as read
    const { data: updated, error: updateError } = await adminClient
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .eq('user_id', user.id) // Extra security check
      .select()
      .single()

    if (updateError) {
      console.error('[PATCH /teams/notifications/:id/read] Error:', updateError)
      return c.json({ error: 'Failed to mark notification as read', details: updateError.message }, 500)
    }

    return c.json({ notification: updated })
  } catch (error: any) {
    console.error('[PATCH /teams/notifications/:id/read] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Mark all notifications as read (Team Leader)
teams.patch('/notifications/read-all', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    if (user.role !== 'team_leader') {
      return c.json({ error: 'Forbidden: This endpoint is only accessible to team leaders' }, 403)
    }

    const adminClient = getAdminClient()

    // SECURITY: Only update notifications belonging to the authenticated user
    const { error: updateError } = await adminClient
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', user.id) // Critical: Only mark user's own notifications as read
      .eq('is_read', false)

    if (updateError) {
      console.error('[PATCH /teams/notifications/read-all] Error:', updateError)
      return c.json({ error: 'Failed to mark notifications as read', details: updateError.message }, 500)
    }

    return c.json({
      message: 'All notifications marked as read',
    })
  } catch (error: any) {
    console.error('[PATCH /teams/notifications/read-all] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

export default teams

