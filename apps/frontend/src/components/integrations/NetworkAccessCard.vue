<script setup lang="ts">
import TacacsHealthCard from './TacacsHealthCard.vue'
import { onMounted, reactive, ref } from 'vue'
import { NAlert, NButton, NCard, NFormItem, NInput, NSelect, NSwitch, NSpin, NEmpty, useMessage, useDialog } from 'naive-ui'
import { DEVICE_PROFILES, classifyNetworkCommand, type DeviceProfile } from '@nodeaccess/shared'
import api from '@/services/api'
import { userService } from '@/services/user.service'
import { hostService } from '@/services/host.service'

type Device = { id:number;hostId:number;name:string;sourceIp:string;enabled:boolean }
type Credential = { userId:number;username:string;name:string;enabled:boolean }
type Grant = { userId:number;hostId:number;commands:string[][] }
type Overview = {settings:{defaultProfile:DeviceProfile;tacacsEnabled:boolean};devices:Device[];credentials:Credential[];grants:Grant[];events:Array<{id:string;username:string;kind:string;outcome:string;deviceId:number;command:string;createdAt:string}>}
const state=ref<Overview|null>(null), loading=ref(true),saving=ref(false),error=ref('')
const message=useMessage(),dialog=useDialog()
const settings=reactive({defaultProfile:'server_ssh' as DeviceProfile,tacacsEnabled:false})
const device=reactive({hostId:null as number|null,sourceIp:'',secret:'',enabled:true})
const credential=reactive({userId:null as number|null,username:'',password:'',enabled:true})
const grant=reactive({userId:null as number|null,hostId:null as number|null,commands:''})
const hostOptions=ref<Array<{label:string;value:number}>>([]),userOptions=ref<Array<{label:string;value:number}>>([])
const hostsLoading=ref(false),usersLoading=ref(false)
let hostRequest=0,userRequest=0
async function searchHosts(search='') {
  const request=++hostRequest;hostsLoading.value=true
  try{const {data}=await hostService.list({search,limit:30,accessProtocol:'ssh'});if(request===hostRequest)hostOptions.value=data.data.map(h=>({label:`${h.name} · ${h.ip}`,value:h.id}))}
  catch{message.error('Não foi possível buscar hosts. Tente novamente.')}
  finally{if(request===hostRequest)hostsLoading.value=false}
}
async function searchUsers(search='') {
  const request=++userRequest;usersLoading.value=true
  try{const {data}=await userService.list({search,limit:30,active:true});if(request===userRequest)userOptions.value=data.data.map(u=>({label:`${u.name} · ${u.email}`,value:u.id}))}
  catch{message.error('Não foi possível buscar usuários. Tente novamente.')}
  finally{if(request===userRequest)usersLoading.value=false}
}
async function load(){loading.value=true;error.value='';try{state.value=(await api.get<Overview>('/network-access')).data;Object.assign(settings,state.value.settings)}catch{error.value='Não foi possível carregar a configuração de rede.'}finally{loading.value=false}}
async function save(path:string,body:unknown){saving.value=true;try{await api.put(`/network-access/${path}`,body);if(path==='devices')device.secret='';if(path==='credentials')credential.password='';message.success('Configuração salva e registrada na auditoria.');await load()}catch(e:any){message.error(e.response?.data?.message??'Não foi possível salvar. Confira os campos e tente novamente.')}finally{saving.value=false}}
function saveSettings(){if(state.value?.settings.tacacsEnabled!==settings.tacacsEnabled){dialog.warning({title:settings.tacacsEnabled?'Ativar TACACS+ deste cliente?':'Desativar TACACS+ deste cliente?',content:'A mudança afeta os próximos pedidos AAA. O serviço separado precisa estar instalado e os equipamentos configurados. Não há liberação automática quando o serviço está indisponível.',positiveText:'Confirmar e salvar',negativeText:'Cancelar',onPositiveClick:()=>save('settings',settings)})}else void save('settings',settings)}
function saveGrant(){const commands=grant.commands.split('\n').map(v=>v.trim()).filter(Boolean).map(v=>v.split(/\s+/));dialog.warning({title:'Confirmar permissões de comandos?',content:`Esta lista substituirá a política deste usuário no equipamento: ${commands.length} comando(s) permitido(s). Comandos fora da lista serão negados. A ACL de conexão continua obrigatória.`,positiveText:'Confirmar permissões',negativeText:'Cancelar',onPositiveClick:()=>save('grants',{userId:grant.userId,hostId:grant.hostId,commands})})}
function remove(kind:string,id:number,label:string,userId?:number){dialog.warning({title:`Remover ${label}?`,content:'A remoção será auditada e afetará os próximos pedidos AAA.',positiveText:'Remover',negativeText:'Cancelar',onPositiveClick:async()=>{saving.value=true;try{await api.delete(`/network-access/${kind}/${id}`,{params:{userId}});await load();message.success('Remoção registrada.')}catch{message.error('Não foi possível remover.')}finally{saving.value=false}}})}
function describe(command:string){const risk=classifyNetworkCommand('cisco_ios',command);return risk==='query'?'Consulta (indicativo)':risk==='configuration'?'Alteração de configuração':'Operação não classificada'}
const eventKindLabels:Record<string,string>={authentication:'Autenticação',authorization:'Autorização',accounting:'Registro de atividade'}
const eventResultLabels:Record<string,string>={permit:'Permitido',deny:'Negado',start:'Iniciado',stop:'Encerrado',update:'Atualização'}
function eventDetails(value:string):{hostId?:number;arguments:string[]} {try{const data=JSON.parse(value);return Array.isArray(data)?{arguments:data}:data}catch{return{arguments:[]}}}
function eventTarget(event:Overview['events'][number]){const details=eventDetails(event.command);return state.value?.devices.find(d=>d.id===event.deviceId)?.name??(details.hostId?`Host #${details.hostId}`:`Equipamento #${event.deviceId}`)}
onMounted(()=>{void load();void searchHosts();void searchUsers()})
</script>

<template>
  <NSpin :show="loading">
    <NAlert v-if="error" type="error" :title="error"><NButton @click="load">Tentar novamente</NButton></NAlert>
    <div v-else-if="state" class="space-y-5" data-testid="network-access-settings">
      <NAlert type="info" title="SSH de servidores continua funcionando como antes">
        O padrão abaixo vale apenas para novos hosts. Equipamentos com AAA existente usam SSH normalmente; o próprio equipamento consulta seu servidor TACACS+.
      </NAlert>
      <NFormItem label="Perfil padrão para novos hosts"><NSelect filterable v-model:value="settings.defaultProfile" :input-props="{ 'aria-label': 'Perfil padrão para novos hosts' }" :options="DEVICE_PROFILES.map(p=>({label:p.label,value:p.value}))" /></NFormItem>
      <NFormItem label="Serviço TACACS+ do NodeAccess (piloto)"><NSwitch v-model:value="settings.tacacsEnabled" aria-label="Ativar TACACS+ do cliente" /></NFormItem>
      <p class="text-sm text-zinc-400">{{ state.settings.tacacsEnabled ? 'Habilitado na política do cliente. Isto não confirma que o listener está online.' : 'Desabilitado. Nenhuma consulta TACACS+ é acrescentada ao SSH comum.' }}</p>
      <NButton type="primary" :loading="saving" @click="saveSettings">Salvar configuração</NButton>
      <NAlert type="warning" title="Preparação do piloto">
        Execute o serviço separado em uma rede de gerenciamento protegida. Configure no equipamento autenticação, autorização de comandos e accounting; apenas autenticar não restringe comandos. Cisco IOS/IOS XE e Junos ainda exigem homologação com equipamentos reais. Automações de servidor e SFTP não são oferecidos nos perfis de rede.
      </NAlert>
      <TacacsHealthCard />
      <NCard title="1. Equipamentos que consultam o TACACS+" size="small">
        <div class="grid gap-3 md:grid-cols-2">
          <NFormItem label="Host cadastrado"><NSelect v-model:value="device.hostId" :input-props="{ 'aria-label': 'Host cadastrado' }" filterable remote :options="hostOptions" :loading="hostsLoading" placeholder="Buscar host por nome ou IP" @search="searchHosts" /></NFormItem>
          <NFormItem label="IP de origem dos pedidos AAA" feedback="Use o IP visto pelo listener, incluindo NAT se houver."><NInput v-model:value="device.sourceIp" :input-props="{ 'aria-label': 'IP de origem dos pedidos AAA' }" placeholder="10.0.0.10" /></NFormItem>
          <NFormItem label="Segredo compartilhado (mínimo 32 caracteres)" feedback="Configure o mesmo segredo no equipamento. Não é exibido após salvar."><NInput v-model:value="device.secret" :input-props="{ 'aria-label': 'Segredo compartilhado' }" type="password" autocomplete="new-password" show-password-on="click" /></NFormItem>
        </div>
        <NButton :disabled="!device.hostId || !device.sourceIp || device.secret.length<32" :loading="saving" @click="save('devices',device)">Salvar equipamento / rotacionar segredo</NButton>
        <NEmpty v-if="!state.devices.length" class="mt-4" description="Nenhum equipamento autorizado a consultar o serviço." />
        <ul v-else class="mt-4 space-y-2"><li v-for="item in state.devices" :key="item.id" class="flex flex-wrap items-center gap-3"><span>{{ item.name }} · {{ item.sourceIp }}</span><NButton size="small" @click="Object.assign(device,{hostId:item.hostId,sourceIp:item.sourceIp,secret:'',enabled:!!item.enabled})">Editar</NButton><NButton size="small" :disabled="saving" @click="remove('devices',item.id,item.name)">Remover</NButton></li></ul>
      </NCard>
      <NCard title="2. Identidades individuais" size="small">
        <p class="mb-3 text-sm">Credencial exclusiva para acesso aos equipamentos. A ACL atual do usuário continua obrigatória. Não use a senha de login no NodeAccess.</p>
        <NFormItem label="Usuário NodeAccess"><NSelect v-model:value="credential.userId" :input-props="{ 'aria-label': 'Usuário NodeAccess' }" filterable remote :options="userOptions" :loading="usersLoading" placeholder="Buscar usuário" @search="searchUsers" /></NFormItem>
        <NFormItem label="Login AAA"><NInput v-model:value="credential.username" :input-props="{ 'aria-label': 'Login AAA' }" autocomplete="off" /></NFormItem>
        <NFormItem label="Senha AAA (16 a 72 caracteres)"><NInput v-model:value="credential.password" :input-props="{ 'aria-label': 'Senha AAA' }" type="password" autocomplete="new-password" show-password-on="click" /></NFormItem>
        <NButton :disabled="!credential.userId || !credential.username || credential.password.length<16 || credential.password.length>72" :loading="saving" @click="save('credentials',credential)">Salvar / rotacionar credencial</NButton>
        <NEmpty v-if="!state.credentials.length" class="mt-4" description="Nenhuma identidade AAA cadastrada." />
        <ul v-else class="mt-4 space-y-2"><li v-for="item in state.credentials" :key="item.userId" class="flex flex-wrap items-center gap-3"><span>{{ item.name }} · {{ item.username }}</span><NButton size="small" @click="Object.assign(credential,{userId:item.userId,username:item.username,password:'',enabled:!!item.enabled})">Editar</NButton><NButton size="small" :disabled="saving" @click="remove('credentials',item.userId,item.username)">Revogar</NButton></li></ul>
      </NCard>
      <NCard title="3. Comandos permitidos por usuário e equipamento" size="small">
        <p class="mb-3 text-sm">Conectar não permite configurar. Cadastre comandos completos, um por linha, sem curingas ou abreviações. Uma lista vazia nega todos os comandos. A classificação é informativa; cada comando cadastrado será permitido integralmente.</p>
        <NFormItem label="Identidade"><NSelect filterable v-model:value="grant.userId" :input-props="{ 'aria-label': 'Identidade da permissão' }" :options="state.credentials.map(c=>({label:`${c.name} · ${c.username}`,value:c.userId}))" /></NFormItem>
        <NFormItem label="Equipamento"><NSelect filterable v-model:value="grant.hostId" :input-props="{ 'aria-label': 'Equipamento da permissão' }" :options="state.devices.map(d=>({label:d.name,value:d.hostId}))" /></NFormItem>
        <NFormItem label="Comandos completos permitidos"><NInput v-model:value="grant.commands" :input-props="{ 'aria-label': 'Comandos completos permitidos' }" type="textarea" placeholder="show version&#10;show interfaces" :autosize="{minRows:3,maxRows:10}" /></NFormItem>
        <ul class="mb-3 text-sm"><li v-for="(line,index) in grant.commands.split('\n').filter(Boolean)" :key="index">{{ describe(line) }}: <code>{{ line }}</code></li></ul>
        <NButton :disabled="!grant.userId || !grant.hostId" :loading="saving" @click="saveGrant">Salvar permissões de comandos</NButton>
        <NEmpty v-if="!state.grants.length" class="mt-4" description="Nenhuma permissão de comando. O padrão é negar." />
        <ul v-else class="mt-4 space-y-2"><li v-for="item in state.grants" :key="`${item.userId}-${item.hostId}`" class="flex flex-wrap items-center gap-3"><span>{{ state.credentials.find(c=>c.userId===item.userId)?.username ?? item.userId }} → {{ state.devices.find(d=>d.hostId===item.hostId)?.name ?? item.hostId }} · {{ item.commands.length }} comandos</span><NButton size="small" @click="Object.assign(grant,{userId:item.userId,hostId:item.hostId,commands:item.commands.map(c=>c.join(' ')).join('\n')})">Editar</NButton><NButton size="small" :disabled="saving" @click="remove('grants',item.hostId,'permissões',item.userId)">Remover</NButton></li></ul>
      </NCard>
      <NCard title="Pedidos AAA recentes (últimos 100)" size="small">
        <NButton size="small" :disabled="loading" @click="load">Atualizar</NButton>
        <NEmpty v-if="!state.events.length" class="mt-4" description="Nenhum pedido registrado. A ativação da política não inicia o listener." />
        <div v-else class="mt-3 overflow-x-auto"><table class="w-full text-left text-sm"><caption class="sr-only">Resultados de autenticação, autorização e accounting</caption><thead><tr><th>Data</th><th>Login</th><th>Equipamento</th><th>Operação</th><th>Resultado</th><th>Argumentos</th></tr></thead><tbody><tr v-for="event in state.events" :key="event.id"><td>{{ new Date(event.createdAt).toLocaleString() }}</td><td>{{ event.username }}</td><td>{{ eventTarget(event) }}</td><td>{{ eventKindLabels[event.kind] ?? event.kind }}</td><td>{{ eventResultLabels[event.outcome] ?? event.outcome }}</td><td><code>{{ eventDetails(event.command).arguments.join(' ') }}</code></td></tr></tbody></table></div>
      </NCard>
    </div>
  </NSpin>
</template>

<style scoped>
/* Long action labels remain readable inside the tenant settings card on mobile. */
:deep(.n-button) {
  max-width: 100%;
  min-height: 30px;
  height: auto;
  padding-top: 6px;
  padding-bottom: 6px;
}
:deep(.n-button__content) {
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: center;
}
th, td { padding: 6px 10px; vertical-align: top; }
th { font-weight: 600; }
</style>
