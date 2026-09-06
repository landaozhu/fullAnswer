// 状态
const PENDING='pending'
const FULLFILED='fullfiled'
const REJECTED='rejected'
class Promise{
  #state=PENDING
  #handles=[]
  constructor(fn){
    const resolveFn=()=>{
      this.#state=FULLFILED
      this.#run()
    }
    const rejectFn=()=>{
      this.#state=REJECTED
      this.#run()
    }
    try {
      fn(resolveFn,rejectFn)
    } catch (error) {
      reject(error)
    }
  }
  #run(){
    if(this.#state===FULLFILED){
      
    }
  }
}
new Promise((resolve,reject)=>{
  resolve()
})
.then(res=>{

})