import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, FileText, FileCheck, Package, FileCode2, Settings, LogOut, ChevronDown, Sun, Moon, Monitor, PanelLeftClose, PanelLeft } from 'lucide-react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';
import iesLogo from '@/assets/ies-logo.png';
const navigation = [{
  title: 'Dashboard',
  href: '/app',
  icon: LayoutDashboard
}, {
  title: 'Customers',
  href: '/app/customers',
  icon: Users
}, {
  title: 'Estimates',
  href: '/app/estimates',
  icon: FileText,
  children: [{
    title: 'All Estimates',
    href: '/app/estimates'
  }, {
    title: 'New Upload',
    href: '/app/estimates/new'
  }]
}, {
  title: 'Quotes',
  href: '/app/quotes',
  icon: FileCheck
}, {
  title: 'Orders',
  href: '/app/orders',
  icon: Package
}, {
  title: 'Templates',
  href: '/app/templates',
  icon: FileCode2
}];
const adminNavigation = [{
  title: 'Users',
  href: '/app/admin/users'
}, {
  title: 'Integrations',
  href: '/app/admin/settings/integrations'
}];
export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    user,
    logout
  } = useAuth();
  const {
    theme,
    setTheme
  } = useTheme();
  const {
    state,
    toggleSidebar
  } = useSidebar();
  const collapsed = state === 'collapsed';
  const isActive = (href: string) => {
    if (href === '/app') {
      return location.pathname === '/app';
    }
    return location.pathname.startsWith(href);
  };
  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };
  const handleLogout = () => {
    logout();
    navigate('/login');
  };
  const isAdmin = user?.role === 'admin' || user?.role === 'hr';
  return <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          <img src={iesLogo} alt="IES Logo" className="h-8 w-auto" />
          {!collapsed && <div className="flex flex-col">
              
              
            </div>}
        </div>
      </SidebarHeader>

      <SidebarContent className="scrollbar-thin">
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50">
            Main
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map(item => <SidebarMenuItem key={item.href}>
                  {item.children ? <Collapsible defaultOpen={isActive(item.href)} className="group/collapsible">
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip={item.title} className={cn(isActive(item.href) && 'bg-sidebar-accent text-sidebar-accent-foreground')}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                          <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.children.map(child => <SidebarMenuSubItem key={child.href}>
                              <SidebarMenuSubButton asChild isActive={location.pathname === child.href}>
                                <a href={child.href}>{child.title}</a>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>)}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </Collapsible> : <SidebarMenuButton asChild tooltip={item.title} isActive={isActive(item.href)}>
                      <a href={item.href}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </a>
                    </SidebarMenuButton>}
                </SidebarMenuItem>)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/50">
              Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminNavigation.map(item => <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild tooltip={item.title} isActive={isActive(item.href)}>
                      <a href={item.href}>
                        <Settings className="h-4 w-4" />
                        <span>{item.title}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <SidebarMenu>
          {/* User menu */}
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="w-full justify-start" tooltip={user?.name || 'User'}>
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">
                      {user ? getInitials(user.name) : '?'}
                    </AvatarFallback>
                  </Avatar>
                  {!collapsed && <div className="flex flex-col items-start text-left">
                      <span className="text-sm font-medium text-sidebar-foreground">
                        {user?.name}
                      </span>
                      <span className="text-xs capitalize text-sidebar-foreground/60">
                        {user?.role}
                      </span>
                    </div>}
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuLabel>Theme</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setTheme('light')}>
                  <Sun className="mr-2 h-4 w-4" />
                  Light
                  {theme === 'light' && <span className="ml-auto text-xs text-primary">✓</span>}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme('dark')}>
                  <Moon className="mr-2 h-4 w-4" />
                  Dark
                  {theme === 'dark' && <span className="ml-auto text-xs text-primary">✓</span>}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme('system')}>
                  <Monitor className="mr-2 h-4 w-4" />
                  System
                  {theme === 'system' && <span className="ml-auto text-xs text-primary">✓</span>}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>

          {/* Collapse toggle button */}
          <SidebarMenuItem>
            <SidebarMenuButton 
              onClick={toggleSidebar}
              tooltip={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="justify-start"
            >
              {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              {!collapsed && <span>Collapse</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>;
}